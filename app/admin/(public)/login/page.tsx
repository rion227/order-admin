// app/admin/login/page.tsx
"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export const dynamic = "force-dynamic"; // ← 事前レンダリングを避ける

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">読み込み中…</div>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false); // 👈 目アイコンで切替
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
      router.replace(nextPath);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-2xl shadow p-6 space-y-4"
      >
        {/* タイトル：PCは従来サイズ、モバイルは少し大きく＆濃く */}
        <h1 className="text-[20px] md:text-xl font-semibold text-gray-900">
          管理者ログイン
        </h1>

        <label className="block">
          {/* ラベル：モバイルで少し濃く */}
          <span className="text-sm text-gray-800 md:text-gray-600">パスワード</span>

          {/* 入力行（目アイコンを右に重ねるため relative） */}
          <div className="relative mt-1">
            <input
              type={showPw ? "text" : "password"}
              className="
                w-full rounded-xl border border-gray-300
                px-3 pr-11 py-2
                outline-none focus:ring-2 focus:ring-black/20
                text-gray-900 caret-gray-900
                placeholder-gray-700 md:placeholder-gray-400
                "
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="入力してください"
              required
              // iOSの自動大文字化などを避ける
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="current-password"
            />

            {/* 目アイコンボタン（クリックで表示/非表示切替） */}
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "パスワードを隠す" : "パスワードを表示"}
              className="
                absolute inset-y-0 right-0
                flex items-center justify-center
                w-10 text-gray-700 hover:text-gray-900
                "
              tabIndex={-1}
            >
              {/* シンプルなSVGアイコン（outline） */}
              {showPw ? (
                // eye-off
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 15.39 6.88 18 12 18c1.61 0 3.06-.246 4.32-.68M7.5 7.5l9 9M10.584 5.338A10.45 10.45 0 0112 6c5.12 0 8.774 2.61 10.066 6-.355.983-.897 1.883-1.595 2.67M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              ) : (
                // eye
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12C3.423 7.943 7.3 5 12 5c4.7 0 8.577 2.943 9.964 7-1.387 4.057-5.264 7-9.964 7-4.7 0-8.577-2.943-9.964-7z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </button>
          </div>
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

        {/* 案内文：PCは従来の淡さ、モバイルは少し濃く */}
        <p className="text-xs text-gray-700 md:text-gray-500">
          成功すると管理ページ（{nextPath}）に移動します。
        </p>
      </form>
    </div>
  );
}
