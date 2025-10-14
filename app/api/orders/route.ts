// app/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- CORS 設定（注文サイトや管理サイトの Origin を並べる）----
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000", // 開発中
  // "https://your-order-site.example", // 後で本番Originを追加
]);

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PATCH",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
  };
}

export async function OPTIONS(req: NextRequest) {
  const headers = corsHeaders(req.headers.get("origin"));
  return new NextResponse(null, { status: 204, headers });
}

// ---- 入力バリデーション ----
const ItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  qty: z.number().int().positive(),
  price: z.number().nonnegative().optional(),
});

const OrderInputSchema = z.object({
  items: z.array(ItemSchema).min(1),
  note: z.string().max(500).optional(),
});

function generateOrderNo() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const short = nanoid(6);
  return `ORD-${y}${m}${day}-${short}`;
}

// ====== POST: 注文を保存（直送） ======
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = OrderInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    // Idempotency（再送防止）
    const idem = req.headers.get("Idempotency-Key") || null;
    if (idem) {
      const { data: existed, error: findErr } = await supabaseAdmin
        .from("orders")
        .select("*")
        .eq("idempotency_key", idem)
        .maybeSingle();
      if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500, headers });
      if (existed) return NextResponse.json({ ok: true, order: existed }, { status: 200, headers });
    }

    const orderNo = generateOrderNo();

    const { data, error } = await supabaseAdmin
      .from("orders")
      .insert([
        {
          order_no: orderNo,
          items: parsed.data.items,
          note: parsed.data.note ?? null,
          status: "pending",
          source: "web",
          idempotency_key: idem,
        },
      ])
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers });

    return NextResponse.json({ ok: true, order: data }, { status: 200, headers });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500, headers });
  }
}

// ====== GET: 一覧取得＋未処理件数 ======
export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status"); // pending|completed|cancelled|null(全件)
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let query = supabaseAdmin
      .from("orders")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);

    const [{ data: rows, error, count }, { count: pending_count }] = await Promise.all([
      query,
      supabaseAdmin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
    ]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers });
    }

    return NextResponse.json(
      {
        ok: true,
        items: rows ?? [],
        total_count: count ?? 0,
        pending_count: pending_count ?? 0,
      },
      { status: 200, headers }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500, headers });
  }
}
