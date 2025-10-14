// app/admin/login/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nextPath = sp.get("next") || "/admin";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErr(json.error || "ログインに失敗しました");
        setLoading(false);
        return;
      }
      // クッキーがセットされるので /admin へ移動
      router.replace(nextPath);
    } catch (e: any) {
      setErr(e?.message ?? "エラーが発生しました");
      setLoading(false);
    }
  }

  // ちょい簡単な見た目（Tailwind）
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-2xl shadow p-6 space-y-4"
      >
        <h1 className="text-xl font-semibold text-gray-800">管理ログイン</h1>
        <label className="block">
          <span className="text-sm text-gray-600">パスワード</span>
          <input
            type="password"
            className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="入力してください"
            required
          />
        </label>

        {err && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2">{err}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-black text-white py-2.5 font-medium disabled:opacity-60"
        >
          {loading ? "確認中…" : "ログイン"}
        </button>

        <p className="text-xs text-gray-500">
          成功すると管理ページ（{nextPath}）に移動します。
        </p>
      </form>
    </div>
  );
}
