// app/api/orders/[order_no]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 既存ファイルと同等のCORSヘッダ関数を利用/複製してください
function corsHeaders(origin: string | null) {
  const allowOrigin = origin ?? "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: NextRequest, { params }: { params: { order_no: string } }) {
  const headers = corsHeaders(req.headers.get("origin"));
  const { order_no } = params;

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("order_no", order_no)
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers });
  if (!data) return NextResponse.json({ ok: false, error: "not found" }, { status: 404, headers });

  return NextResponse.json({ ok: true, item: data }, { status: 200, headers });
}
