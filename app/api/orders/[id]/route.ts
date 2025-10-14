// app/api/orders/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  // "https://your-admin-site.example", // 本番で追加
]);
function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS(req: NextRequest) {
  const headers = corsHeaders(req.headers.get("origin"));
  return new NextResponse(null, { status: 204, headers });
}

const PatchSchema = z.object({
  status: z.enum(["completed", "cancelled", "pending"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const headers = corsHeaders(req.headers.get("origin"));
  const id = params.id;

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

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers });
    }
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers });
    }

    return NextResponse.json({ ok: true, order: data }, { status: 200, headers });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500, headers });
  }
}
