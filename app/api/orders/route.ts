// app/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 許可オリジン（厳格化するときに使う）
const THIS_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN || "http://localhost:3000";
const ALLOWED = new Set<string>([
  "http://localhost:3000",
  THIS_ORIGIN, // Render 本番
  "https://qr-order-sigma.vercel.app", // お客様サイト
]);

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "";
  const reqHdrs =
    req.headers.get("access-control-request-headers") ??
    "content-type, idempotency-key";
  // ★まずは確実に通すために "*"。通るのを確認後、次の1行に置き換えて厳格化してください。
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

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

/* ====== GET /api/orders ======
 * ?limit=20&offset=0&status=pending
 */
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

    const { data: items, count, error } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500, headers }
      );
    }

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

/* ====== POST /api/orders ======
 * body: { items:[{id,name,qty,price?}], note? }
 * header: Idempotency-Key（任意）
 */
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

    // かんたんな注文番号
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const orderNo = `ORD-${y}${m}${d}-${nanoid(6)}`;

    const idempotencyKey = req.headers.get("idempotency-key");

    // 既存キーがあればその注文を返す（簡易実装）
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

    const payload = {
      order_no: orderNo,
      items: parsed.data.items,
      note: parsed.data.note ?? null,
      status: "pending" as const,
      source: "web",
      idempotency_key: idempotencyKey ?? null,
    };

    const { data, error } = await supabaseAdmin
      .from("orders")
      .insert(payload)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500, headers }
      );
    }

    return NextResponse.json({ ok: true, order: data }, { status: 200, headers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500, headers });
  }
}
