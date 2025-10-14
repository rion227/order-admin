// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ADMIN_PREFIX = "/admin";

// ログインページ配下は常に素通り（/admin/login, /admin/login?next=... など）
function isLoginPath(pathname: string) {
  return pathname === "/admin/login" || pathname.startsWith("/admin/login/");
}

export function middleware(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const { pathname, search } = url;

    // /admin 配下以外は関知しない
    const isAdminArea =
      pathname === ADMIN_PREFIX || pathname.startsWith(ADMIN_PREFIX + "/");
    if (!isAdminArea) return NextResponse.next();

    // ログインページは必ず通す
    if (isLoginPath(pathname)) return NextResponse.next();

    // クッキーで簡易認証
    const isAuthed = req.cookies.get("admin_auth")?.value === "1";
    if (isAuthed) return NextResponse.next();

    // 未ログイン → /admin/login?next=<元のパス+クエリ> にリダイレクト
    const loginUrl = new URL("/admin/login", req.url);
    const nextParam = pathname + (search || "");
    loginUrl.searchParams.set("next", nextParam);
    return NextResponse.redirect(loginUrl);
  } catch {
    // ここで落ちると 500 になるので、念のため素通りにする
    return NextResponse.next();
  }
}

// /admin と /admin/... の両方で作動
export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
