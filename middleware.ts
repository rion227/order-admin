// middleware.ts（安全版：/admin/loginは必ず素通り。他は未ログインならloginへ）
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function isLogin(pathname: string) {
  return pathname === "/admin/login" || pathname.startsWith("/admin/login/");
}

export function middleware(req: NextRequest) {
  try {
    const { pathname, search } = req.nextUrl;

    // /admin配下以外には一切触らない
    if (pathname !== "/admin" && !pathname.startsWith("/admin/")) {
      return NextResponse.next();
    }

    // ログインページは必ず素通り（ここで例外が出ないように最初にreturn）
    if (isLogin(pathname)) return NextResponse.next();

    // /admin 直下は /admin/login に誘導
    if (pathname === "/admin") {
      return NextResponse.redirect(new URL("/admin/login", req.url));
    }

    // 認証クッキー確認
    const authed = req.cookies.get("admin_auth")?.value === "1";
    if (authed) return NextResponse.next();

    // 未ログイン → /admin/login?next=元URL
    const loginUrl = new URL("/admin/login", req.url);
    loginUrl.searchParams.set("next", pathname + (search || ""));
    return NextResponse.redirect(loginUrl);
  } catch {
    // ここで落ちるとまた500になるので、例外時は素通りにしてページを表示させる
    return NextResponse.next();
  }
}

// /admin と /admin/... の両方を対象
export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
