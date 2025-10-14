// app/admin/(protected)/layout.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies(); // ← ここをawait
  const authed = cookieStore.get("admin_auth")?.value === "1";

  if (!authed) {
    redirect("/admin/login"); // 未ログインはログインへ（ここで処理終了）
  }

  return <>{children}</>;
}
