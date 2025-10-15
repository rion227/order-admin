// app/api/orders/stop/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const THIS_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN || "http://localhost:3000";
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  THIS_ORIGIN,                      // Render本番
  "https://qr-order-sigma.vercel.app", // お客さまサイト
]);

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

const TABLE = "app_settings";
const KEY = "order_stop";

/** 読み取り専用：現在の停止状態を返す */
export async function GET(req: NextRequest) {
  const headers = corsHeaders(req.headers.get("origin"));

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("value")
    .eq("key", KEY)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers });
  }

  const stopped = !!data?.value?.stopped;
  return NextResponse.json({ ok: true, stopped }, { status: 200, headers });
}
