// app/api/orders/reset/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/orders/reset
export async function POST(_req: NextRequest) {
  // ★ Next.js 15: cookies() は Promise なので await が必要
  const auth = (await cookies()).get("admin_auth")?.value;
  if (auth !== "1") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // 未処理以外（= 完了/キャンセル）を削除
  const { error } = await supabaseAdmin
    .from("orders")
    .delete()
    .in("status", ["completed", "cancelled"]);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

/** 明示的にその他メソッドは 405 を返す */
export function GET() {
  return NextResponse.json({ ok: false, error: "Method not allowed" }, { status: 405 });
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
