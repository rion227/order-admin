// middleware.ts（デバッグ用の最小版）
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /admin は /admin/login にだけリダイレクト（その他は何もしない）
  if (pathname === "/admin") {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }
  // /admin/login を含め、他は全部素通り（認証チェックは一旦オフ）
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
