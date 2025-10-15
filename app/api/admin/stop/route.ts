import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "app_settings";
const KEY = "order_stop";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("value")
    .eq("key", KEY)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const stopped = !!(data?.value?.stopped);
  return NextResponse.json({ ok: true, stopped }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const { stopped } = await req.json().catch(() => ({}));
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .upsert({ key: KEY, value: { stopped: !!stopped } }, { onConflict: "key" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, stopped: !!data?.value?.stopped }, { status: 200 });
}
