// app/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- CORS 設定 ----
const THIS_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN || "http://localhost:3000";

// 固定許可 + Vercel のお客様アプリ（プレビュー含む）を許可
const FIXED_ALLOW = new Set<string>([
  "http://localhost:3000",
  THIS_ORIGIN, // Render の本番 URL（NEXT_PUBLIC_SITE_ORIGIN）
  "https://qr-order-sigma.vercel.app", // 本番のお客様サイト
]);

function isAllowedOrigin(origin: string | null): string {
  if (!origin) return "";
  if (FIXED_ALLOW.has(origin)) return origin;
  // プレビュー用（例: https://qr-order-xxxxx-rions-projects-...vercel.app）
  try {
    const u = new URL(origin);
    if (
      u.protocol === "https:" &&
      u.hostname.endsWith(".vercel.app") &&
      u.hostname.startsWith("qr-order-")
    ) {
      return origin;
    }
  } catch {}
  return "";
}

function corsHeaders(origin: string | null) {
  const allow = isAllowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

// ---- 共通: 停止中かどうか ----
async function isStopped() {
  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "order_stop")
    .single();
  if (error && error.code !== "PGRST116") return false; // テーブル未作成時などは false 扱い
  return Boolean(data?.value?.stopped);
}

// ---- GET /api/orders （一覧）----
export async function GET(req: NextRequest) {
  const headers = corsHeaders(req.headers.get("origin"));
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);
    const status = searchParams.get("status") as
      | "pending"
      | "completed"
      | "cancelled"
      | ""
      | null;

    let q = supabaseAdmin
      .from("orders")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status === "pending" || status === "completed" || status === "cancelled") {
      q = q.eq("status", status);
    }
    const { data, error, count } = await q;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers });
    }

    // 未処理件数も同時に返す
    const { count: pendingCount } = await supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    return NextResponse.json(
      { ok: true, items: data ?? [], total_count: count ?? 0, pending_count: pendingCount ?? 0 },
      { status: 200, headers },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers });
  }
}

// ---- POST /api/orders （作成・お客様サイトからの送信）----
const ItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  qty: z.number().int().positive(),
  price: z.number().nonnegative().optional(),
});
const CreateSchema = z.object({
  items: z.array(ItemSchema).min(1),
  note: z.string().max(500).optional(),
});

function yyyymmdd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${dd}`;
}
function random4() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req.headers.get("origin"));

  // 停止中なら 403（必ず CORS ヘッダ付きで返す）
  if (await isStopped()) {
    return NextResponse.json(
      { ok: false, error: "只今ご注文を停止しています。再開までお待ちください。" },
      { status: 403, headers },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "invalid payload", detail: parsed.error.flatten() },
        { status: 400, headers },
      );
    }

    // 注文番号（YYYYMMDD-XXXX）・衝突したら少しリトライ
    const prefix = yyyymmdd();
    let orderNo = `${prefix}-${random4()}`;
    let tries = 0;
    while (tries < 5) {
      const { data, error } = await supabaseAdmin
        .from("orders")
        .insert({
          order_no: orderNo,
          items: parsed.data.items,
          note: parsed.data.note ?? null,
          status: "pending",
          source: "web",
        })
        .select()
        .single();

      if (!error) {
        return NextResponse.json({ ok: true, order: data }, { status: 200, headers });
      }

      // 重複なら再試行（Postgres の一意制約名は環境により異なるので includes で判定）
      if (String(error.message).toLowerCase().includes("duplicate")) {
        tries++;
        orderNo = `${prefix}-${random4()}`;
        continue;
      }

      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers });
    }

    return NextResponse.json(
      { ok: false, error: "failed to create order (collision)" },
      { status: 500, headers },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers });
  }
}
