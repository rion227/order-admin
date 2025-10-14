// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ADMIN_PREFIX = "/admin";
const PUBLIC_PATHS = new Set([
  "/admin/login",        // ログインページは誰でも見れる
]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /admin 配下だけを見る（/admin と /admin/...）
  const isAdminArea =
    pathname === ADMIN_PREFIX || pathname.startsWith(ADMIN_PREFIX + "/");

  if (!isAdminArea) {
    // それ以外のパスは素通り
    return NextResponse.next();
  }

  // /admin/login は素通り
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // クッキーに "admin_auth=1" があればログイン扱い
  const cookie = req.cookies.get("admin_auth")?.value;
  const isAuthed = cookie === "1";

  if (isAuthed) {
    return NextResponse.next();
  }

  // 未ログイン → /admin/login にリダイレクト（元の場所は next= で渡す）
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/admin/login";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

// ミドルウェアを有効にする対象
export const config = {
  matcher: ["/admin/:path*"],
};
