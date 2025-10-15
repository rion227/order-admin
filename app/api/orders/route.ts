// app/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CORS 設定
const THIS_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN || "http://localhost:3000";
const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:3000",
  THIS_ORIGIN,                         // 管理画面(Render等)
  "https://qr-order-sigma.vercel.app", // お客様サイト
]);

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

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

// 停止中か？
async function isStopped() {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "order_stop")
    .single();
  return !!data?.value?.stopped;
}

// 受付番号: YYYYMMDD-XXXX（4桁）
function datePrefix(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
function rand4() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}
async function generateOrderNo() {
  const prefix = datePrefix();
  for (let i = 0; i < 50; i++) {
    const order_no = `${prefix}-${rand4()}`;
    const { data } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("order_no", order_no)
      .limit(1);
    if (!data || data.length === 0) return order_no;
  }
  throw new Error("failed to generate unique order_no");
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req.headers.get("origin"));

  // ── 停止中なら 403 で拒否
  if (await isStopped()) {
    return NextResponse.json(
      { ok: false, code: "ORDER_STOPPED", message: "ただいま注文停止中です。再開までお待ちください。" },
      { status: 403, headers },
    );
  }

  // べき等キー（同一キーは重複作成しない）
  const idem = req.headers.get("Idempotency-Key") || null;
  if (idem) {
    const { data: existed } = await supabaseAdmin
      .from("orders")
      .select("order_no, items, note, status, created_at, updated_at")
      .eq("idempotency_key", idem)
      .single();
    if (existed) {
      return NextResponse.json({ ok: true, order: existed, order_no: existed.order_no }, { status: 200, headers });
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400, headers },
      );
    }

    // 注文番号生成
    const order_no = await generateOrderNo();

    // 保存
    const { data, error } = await supabaseAdmin
      .from("orders")
      .insert({
        order_no,
        items: parsed.data.items,
        note: parsed.data.note ?? "",
        status: "pending",
        source: "web",
        idempotency_key: idem,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers });
    }

    return NextResponse.json({ ok: true, order: data, order_no }, { status: 200, headers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers });
  }
}
