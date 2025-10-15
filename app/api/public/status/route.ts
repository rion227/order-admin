import { NextResponse, NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "app_settings";
const KEY = "order_stop";

const THIS_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN || "http://localhost:3000";
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  THIS_ORIGIN,
  "https://qr-order-sigma.vercel.app",
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
  const headers = corsHeaders(req.headers.get("origin"));
  return new NextResponse(null, { status: 204, headers });
}

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
  const stopped = !!(data?.value?.stopped);
  return NextResponse.json(
    { ok: true, stopped, message: stopped ? "只今注文停止中。再開までお待ちください。" : "" },
    { status: 200, headers }
  );
}
