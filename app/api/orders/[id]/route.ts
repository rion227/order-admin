// app/api/orders/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 許可オリジン（厳格化時に使用）
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
    req.headers.get("access-control-request-headers") ?? "content-type";
  // ★まずは "*" で確実に通す。通るのを確認後に下行へ変更し厳格化。
  const allowOrigin = "*";
  // const allowOrigin = ALLOWED.has(origin) ? origin : "";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "PATCH, OPTIONS",
    "Access-Control-Allow-Headers": reqHdrs,
    "Access-Control-Max-Age": "600",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

const PatchSchema = z.object({
  status: z.enum(["completed", "cancelled", "pending"]),
});

export async function PATCH(
  req: NextRequest,
  // Next.js 15: params は Promise で来る
  ctx: { params: Promise<{ id: string }> }
) {
  const headers = corsHeaders(req);
  const { id } = await ctx.params;

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("orders")
      .update({ status: parsed.data.status })
      .eq("id", id)
      .select()
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500, headers });
    if (!data)
      return NextResponse.json({ error: "Not found" }, { status: 404, headers });

    return NextResponse.json({ ok: true, order: data }, { status: 200, headers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500, headers });
  }
}
