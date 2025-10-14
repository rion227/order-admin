// app/admin/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

export default function AdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [error, setError] = useState<string | null>(null);

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
    // 楽観的更新：先にUIだけ反映
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
      // 未処理件数の取り直し
      fetchList();
    } catch (e: unknown) {
      // 失敗したら元に戻す
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

  // 5秒ごとに自動更新（最新の件数/一覧を軽く取る）
  useEffect(() => {
    const t = setInterval(fetchList, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const grouped = useMemo(() => {
    // 未処理を上、その他を下に
    const pending = orders.filter((o) => o.status === "pending");
    const done = orders.filter((o) => o.status !== "pending");
    return { pending, done };
  }, [orders]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
          <h1 className="text-xl font-semibold">注文管理</h1>
          <span className="ml-2 inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm">
            未処理 <span className="ml-1 font-bold">{pendingCount}</span>
          </span>

          <div className="ml-auto flex items-center gap-2">
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

            <button
              onClick={fetchList}
              className="rounded-lg border px-3 py-1.5 text-sm"
              title="更新"
            >
              更新
            </button>

            {/* ログアウトボタン */}
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

      <main className="mx-auto max-w-5xl px-4 py-6">
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
                    <OrderCard key={o.id} order={o} onUpdate={updateStatus} />
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
                    <OrderCard key={o.id} order={o} onUpdate={updateStatus} />
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
    </div>
  );
}

function OrderCard({
  order,
  onUpdate,
}: {
  order: Order;
  onUpdate: (id: string, status: Order["status"]) => void;
}) {
  const isDone = order.status !== "pending";
  return (
    <li
      className={`rounded-2xl border bg-white p-4 shadow-sm transition ${
        isDone ? "opacity-60" : ""
      }`}
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
          {order.status === "pending"
            ? "未処理"
            : order.status === "completed"
            ? "完了"
            : "キャンセル"}
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

      {order.note && (
        <p className="mt-1 text-sm text-gray-500">メモ：{order.note}</p>
      )}

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
