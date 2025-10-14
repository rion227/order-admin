// app/api/admin/login/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const input = String(body?.password ?? "");
  const ok = input.length > 0 && input === process.env.ADMIN_PASSWORD;

  if (!ok) {
    return NextResponse.json({ ok: false, error: "パスワードが違います" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  // 管理クッキーを付与（有効期限 7日）
  res.cookies.set("admin_auth", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,        // 本番(https)では true 推奨
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}

export async function GET() {
  // ログイン状態の簡易チェック用（任意）
  return NextResponse.json({ ok: true });
}
