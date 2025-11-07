// app/api/orders/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** =========================
 * CORS（必要に応じて許可リストに変更可）
 * ========================= */
function corsHeaders(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin = origin; // 必要なら許可ドメインのみに絞る
  const reqHdrs =
    req.headers.get("access-control-request-headers") ?? "content-type";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Credentials": "True",
    "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": reqHdrs,
    "Access-Control-Max-Age": "600",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

/** UUID らしさの簡易判定 */
const UUIDish =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** =========================================
 * GET: params.id を
 *  1) order_no（受付番号）として検索
 *  2) 見つからず UUID らしければ id でも検索
 * 返り値は { ok: true, item: {...} } に統一
 * ========================================= */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const headers = corsHeaders(req);
  const key = params.id;

  // 1) order_no で検索
  let { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("order_no", key)
    .limit(1)
    .maybeSingle();

  // 2) 見つからず UUID っぽければ id でも検索
  if (!data && UUIDish.test(key)) {
    const res2 = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", key)
      .limit(1)
      .maybeSingle();
    data = res2.data ?? null;
    error = res2.error ?? null;
  }

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers }
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "not found" },
      { status: 404, headers }
    );
  }

  return NextResponse.json({ ok: true, item: data }, { status: 200, headers });
}

/** =========================
 * PATCH: ステータス更新（既存仕様踏襲）
 * ========================= */
const PatchSchema = z.object({
  status: z.enum(["completed", "cancelled", "pending"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const headers = corsHeaders(req);
  const idOrNo = params.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400, headers }
    );
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid body" },
      { status: 400, headers }
    );
  }

  const { status } = parsed.data;

  // UUID なら id、そうでなければ order_no で更新
  const col = UUIDish.test(idOrNo) ? "id" : "order_no";
  const { error } = await supabaseAdmin
    .from("orders")
    .update({ status })
    .eq(col, idOrNo);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers }
    );
  }

  return NextResponse.json({ ok: true }, { status: 200, headers });
}
