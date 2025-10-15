// app/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { randomInt } from "crypto";

// ===== ここはあなたのプロジェクトの方針に合わせてOK =====
// 既存の CORS 設定があるなら差し替えて使ってください。
const THIS_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN || "http://localhost:3000";
const ALLOWED = new Set<string>([
  "http://localhost:3000",
  THIS_ORIGIN,
  "https://qr-order-sigma.vercel.app",
]);

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "";
  const reqHdrs =
    req.headers.get("access-control-request-headers") ??
    "content-type, idempotency-key";
  // 厳格運用
  const allowOrigin = ALLOWED.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": reqHdrs,
    "Access-Control-Max-Age": "600",
  };
}
// ===========================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// クライアント→APIのリクエスト体裁
const ItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  qty: z.number().int().positive(),
  price: z.number().nonnegative().optional(),
});
const CreateSchema = z.object({
  items: z.array(ItemSchema).min(1),
  note: z.string().max(500).optional().nullable(),
});

// JSTの YYYYMMDD を作る
function yyyymmddJST(): string {
  const f = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = f.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  const d = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${y}${m}${d}`;
}
// ランダム4桁（0000–9999）
function rand4(): string {
  return String(randomInt(0, 10000)).padStart(4, "0");
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

/** GET /api/orders?limit&offset&status */
export async function GET(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 100);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const status = searchParams.get("status");

    let query = supabaseAdmin
      .from("orders")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);

    const { data: items, count, error } = await query.range(
      offset,
      offset + limit - 1
    );
    if (error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500, headers }
      );

    const { count: pendingCount } = await supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    return NextResponse.json(
      {
        ok: true,
        items: items ?? [],
        total_count: count ?? 0,
        pending_count: pendingCount ?? 0,
      },
      { status: 200, headers }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers });
  }
}

/** POST /api/orders  →  20251015-0427 形式の order_no を採番 */
export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const idempotencyKey = req.headers.get("idempotency-key");

    // すでに同じキーで作っていたらそれを返す（重複送信防止）
    if (idempotencyKey) {
      const { data: dup } = await supabaseAdmin
        .from("orders")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (dup) {
        return NextResponse.json({ ok: true, order: dup }, { status: 200, headers });
      }
    }

    const base = {
      items: parsed.data.items,
      note: parsed.data.note ?? null,
      status: "pending" as const,
      source: "web" as const,
      idempotency_key: idempotencyKey ?? null,
    };

    // ユニーク違反(23505)時は番号取り直し
    const MAX_RETRY = 20;
    for (let i = 0; i < MAX_RETRY; i++) {
      const order_no = `${yyyymmddJST()}-${rand4()}`;
      const { data, error } = await supabaseAdmin
        .from("orders")
        .insert([{ ...base, order_no }])
        .select()
        .single();

      if (!error && data) {
        return NextResponse.json(
          { ok: true, order: data, order_no: data.order_no },
          { status: 200, headers }
        );
      }
      // Postgres unique violation
      if ((error as any)?.code !== "23505") {
        return NextResponse.json(
          { ok: false, error: (error as any)?.message ?? "Insert failed" },
          { status: 500, headers }
        );
      }
      // 23505 のときだけ番号取り直し
    }

    return NextResponse.json(
      { ok: false, error: "番号が取りきれませんでした。時間をおいて再度お試しください。" },
      { status: 503, headers }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers });
  }
}
