// app/admin/(protected)/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type Order = {
  id: string;
  order_no: string;
  items: { id: string; name: string; qty: number; price?: number }[];
  note?: string | null;
  status: "pending" | "completed" | "cancelled";
  created_at: string;
  updated_at: string;
};

type ListResp = {
  ok: boolean;
  items: Order[];
  total_count: number;
  pending_count: number;
  error?: string;
};

type StatusFilter = "" | "pending" | "completed" | "cancelled";

// ---- Supabase（ブラウザ用） ----
let supabase: SupabaseClient | null = null;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (typeof window !== "undefined" && SUPABASE_URL && SUPABASE_ANON) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
}

export default function AdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [error, setError] = useState<string | null>(null);

  // === 通知系（音・揺れ・ハイライト） ===
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false); // クリックで有効化（ブラウザの自動再生制限対策）
  const knownPendingIds = useRef<Set<string>>(new Set());  // 直近までに存在していた pending のID
  const initialized = useRef(false);                       // 初回同期は通知しない
  const [buzzIds, setBuzzIds] = useState<Set<string>>(new Set()); // 揺らす対象

  const triggerNotify = (newIds: string[]) => {
    // 音
    if (soundEnabled) {
      // 再生は失敗（ユーザー操作前など）しても無視
      audioRef.current?.play().catch(() => {});
    }
    // 端末バイブ（対応端末のみ）
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      // 短く2発
      (navigator as any).vibrate?.([120, 80, 120]);
    }
    // 揺れアニメーション（数秒で解除）
    if (newIds.length > 0) {
      setBuzzIds((prev) => new Set([...Array.from(prev), ...newIds]));
      setTimeout(() => {
        setBuzzIds((prev) => {
          const next = new Set(prev);
          newIds.forEach((id) => next.delete(id));
          return next;
        });
      }, 6000); // 6秒で解除
    }
  };

  // ===== API =====
  async function fetchList() {
    try {
      const q = new URLSearchParams();
      if (statusFilter) q.set("status", statusFilter);
      const res = await fetch(`/api/orders?${q.toString()}`, { credentials: "include" });
      const json: ListResp = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "一覧の取得に失敗しました");
      }

      // 新規 pending の検出（「増えたID」だけ通知）
      const currentPending = json.items.filter((o) => o.status === "pending");
      const currentIdsSet = new Set(currentPending.map((o) => o.id));

      // 初回はベースラインだけ作って通知しない
      if (!initialized.current) {
        knownPendingIds.current = currentIdsSet;
        initialized.current = true;
      } else {
        const newIds: string[] = [];
        currentIdsSet.forEach((id) => {
          if (!knownPendingIds.current.has(id)) newIds.push(id);
        });
        if (newIds.length > 0) triggerNotify(newIds);
        knownPendingIds.current = currentIdsSet;
      }

      setOrders(json.items);
      setPendingCount(json.pending_count);
      setError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: string, status: Order["status"]) {
    const prev = orders;
    setOrders((cur) => cur.map((o) => (o.id === id ? { ...o, status } : o)));
    try {
      const res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "更新に失敗しました");
      }
      // 状態の取り直し
      fetchList();
    } catch (e: unknown) {
      setOrders(prev);
      const msg = e instanceof Error ? e.message : String(e);
      alert(msg || "更新に失敗しました");
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    router.replace("/admin/login");
  }

  // 初回＆フィルタ変更時に取得
  useEffect(() => {
    setLoading(true);
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // === ポーリング：前面5秒 / 背景60秒。前面復帰で即fetch ===
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const schedule = (ms: number) => {
      if (timer) clearInterval(timer);
      timer = setInterval(fetchList, ms);
    };

    const onVisibility = () => {
      if (document.hidden) {
        schedule(60_000); // 背景は60秒
      } else {
        fetchList();      // 前面に戻った瞬間に更新
        schedule(5_000);  // 前面は5秒
      }
    };

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // === Realtime: orders テーブルの INSERT / UPDATE を即時反映 ===
  useEffect(() => {
    if (!supabase) {
      console.warn("Supabase Realtime disabled: env not set");
      return;
    }
    // 連打抑制（1秒に1回まで）
    let last = 0;
    const trigger = () => {
      const now = Date.now();
      if (now - last > 1000) {
        last = now;
        fetchList();
      }
    };

    const channel = supabase
      .channel("orders-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, trigger)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, trigger)
      .subscribe();

    return () => {
      supabase?.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const grouped = useMemo(() => {
    const pending = orders.filter((o) => o.status === "pending");
    const done = orders.filter((o) => o.status !== "pending");
    return { pending, done };
  }, [orders]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 通知音 */}
      <audio ref={audioRef} src="/notify.mp3" preload="auto" />

      {/* ヘッダー */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
          <h1 className="text-xl font-semibold">注文管理</h1>

          <span className="ml-2 inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm">
            未処理 <span className="ml-1 font-bold">{pendingCount}</span>
          </span>

          <div className="ml-auto flex items-center gap-2">
            {/* サウンド有効化トグル（初回クリックで音が鳴るようになる） */}
            <button
              onClick={() => setSoundEnabled((v) => !v)}
              className={`rounded-lg px-3 py-1.5 text-sm border ${
                soundEnabled ? "bg-green-600 text-white" : "bg-white"
              }`}
              title="音のオン/オフ"
            >
              🔔 {soundEnabled ? "音 ON" : "音 OFF"}
            </button>

            <select
              className="rounded-lg border px-3 py-1.5 text-sm"
              value={statusFilter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setStatusFilter(e.target.value as StatusFilter)
              }
            >
              <option value="">すべて</option>
              <option value="pending">未処理のみ</option>
              <option value="completed">完了のみ</option>
              <option value="cancelled">キャンセルのみ</option>
            </select>

            <button onClick={fetchList} className="rounded-lg border px-3 py-1.5 text-sm" title="更新">
              更新
            </button>

            <button
              onClick={logout}
              className="rounded-lg bg-gray-900 text-white px-3 py-1.5 text-sm"
              title="ログアウト"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6" aria-live="polite">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : (
          <>
            {/* 未処理 */}
            {grouped.pending.length > 0 && (
              <>
                <h2 className="mb-2 text-sm font-semibold text-gray-600">未処理</h2>
                <ul className="mb-6 grid gap-3">
                  {grouped.pending.map((o) => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      onUpdate={updateStatus}
                      buzzing={buzzIds.has(o.id)}
                    />
                  ))}
                </ul>
              </>
            )}

            {/* 処理済み（完了/キャンセル） */}
            {grouped.done.length > 0 && (
              <>
                <h2 className="mb-2 text-sm font-semibold text-gray-600">処理済み</h2>
                <ul className="grid gap-3">
                  {grouped.done.map((o) => (
                    <OrderCard key={o.id} order={o} onUpdate={updateStatus} buzzing={false} />
                  ))}
                </ul>
              </>
            )}

            {grouped.pending.length === 0 && grouped.done.length === 0 && (
              <p className="text-sm text-gray-500">注文はまだありません。</p>
            )}
          </>
        )}
      </main>

      {/* 揺れアニメーション（シンプルなバイブ風） */}
      <style jsx global>{`
        @keyframes buzz {
          0% { transform: translate3d(0, 0, 0); }
          10% { transform: translate3d(-2px, 0, 0); }
          20% { transform: translate3d(2px, 0, 0); }
          30% { transform: translate3d(-2px, 0, 0); }
          40% { transform: translate3d(2px, 0, 0); }
          50% { transform: translate3d(-1px, 0, 0); }
          60% { transform: translate3d(1px, 0, 0); }
          70% { transform: translate3d(-1px, 0, 0); }
          80% { transform: translate3d(1px, 0, 0); }
          90% { transform: translate3d(0, 0, 0); }
          100%{ transform: translate3d(0, 0, 0); }
        }
        .buzz {
          animation: buzz 0.4s linear infinite;
        }
        .glow {
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.35);
        }
      `}</style>
    </div>
  );
}

function OrderCard({
  order,
  onUpdate,
  buzzing,
}: {
  order: Order;
  onUpdate: (id: string, status: Order["status"]) => void;
  buzzing: boolean;
}) {
  const isDone = order.status !== "pending";
  return (
    <li
      className={`rounded-2xl border bg-white p-4 shadow-sm transition ${
        isDone ? "opacity-60" : ""
      } ${buzzing ? "buzz glow" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">{order.order_no}</span>
        <span
          className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs border ${
            order.status === "pending"
              ? "bg-yellow-50 border-yellow-200 text-yellow-700"
              : order.status === "completed"
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {order.status === "pending" ? "未処理" : order.status === "completed" ? "完了" : "キャンセル"}
        </span>

        <span className="ml-auto text-xs text-gray-400">
          {new Date(order.created_at).toLocaleString()}
        </span>
      </div>

      <ul className="mt-2 text-sm text-gray-800 list-disc pl-5">
        {order.items.map((it, idx) => (
          <li key={idx}>
            {it.name} × {it.qty}
          </li>
        ))}
      </ul>

      {order.note && <p className="mt-1 text-sm text-gray-500">メモ：{order.note}</p>}

      <div className="mt-3 flex gap-2">
        <button
          className="rounded-xl bg-green-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={() => onUpdate(order.id, "completed")}
          disabled={isDone}
        >
          ✅ 完了
        </button>
        <button
          className="rounded-xl bg-red-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={() => onUpdate(order.id, "cancelled")}
          disabled={isDone}
        >
          🗑 キャンセル
        </button>
      </div>
    </li>
  );
}
