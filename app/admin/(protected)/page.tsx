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

async function safeJson<T = any>(res: Response): Promise<T | {}> {
  try {
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) return {};
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text) as T;
  } catch {
    return {};
  }
}

export default function AdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [error, setError] = useState<string | null>(null);

  // 通知系
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const knownPendingIds = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const [buzzIds, setBuzzIds] = useState<Set<string>>(new Set());

  // STOPトグル
  const [isStopped, setIsStopped] = useState(false);

  // リセット確認モーダル
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const playNotify = () => {
    if (!soundEnabled) return;
    const a = audioRef.current;
    if (!a) return;
    try {
      a.currentTime = 0;
      a.play()?.catch(() => {});
    } catch {}
  };

  const triggerNotify = (newIds: string[]) => {
    playNotify();
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      (navigator as any).vibrate?.(120);
    }
    if (newIds.length > 0) {
      setBuzzIds((prev) => new Set([...Array.from(prev), ...newIds]));
      setTimeout(() => {
        setBuzzIds((prev) => {
          const next = new Set(prev);
          newIds.forEach((id) => next.delete(id));
          return next;
        });
      }, 1200);
    }
  };

  // ===== API =====
  async function fetchList() {
    try {
      const q = new URLSearchParams();
      if (statusFilter) q.set("status", statusFilter);
      const res = await fetch(`/api/orders?${q.toString()}`, { credentials: "include" });
      const json = (await safeJson<ListResp>(res)) as Partial<ListResp>;
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `一覧の取得に失敗しました（HTTP ${res.status}）`);
      }

      const items = json.items || [];
      const currentPending = items.filter((o) => o.status === "pending");
      const currentIdsSet = new Set(currentPending.map((o) => o.id));

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

      setOrders(items);
      setPendingCount(json.pending_count ?? currentPending.length);
      setError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "サーバーが不正な応答を返しました");
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
      const json = (await safeJson(res)) as any;
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `更新に失敗しました（HTTP ${res.status}）`);
      }
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

  async function fetchStopState() {
    try {
      const r = await fetch("/api/admin/stop", { cache: "no-store", credentials: "include" });
      const j = (await safeJson(r)) as any;
      if (j?.ok) setIsStopped(!!j.stopped);
    } catch {}
  }

  async function toggleStop() {
    try {
      const next = !isStopped;
      const r = await fetch("/api/admin/stop", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stopped: next }),
      });
      const j = (await safeJson(r)) as any;
      if (j?.ok) setIsStopped(!!j.stopped);
    } catch (e) {
      console.error(e);
      alert("切り替えに失敗しました");
    }
  }

  async function execResetProcessedOnly() {
    setConfirmBusy(true);
    try {
      const r = await fetch("/api/orders/reset", { method: "POST", credentials: "include" });
      const j = (await safeJson(r)) as any;
      if (!r.ok || j?.ok === false) {
        throw new Error(j?.error || `リセットに失敗しました（HTTP ${r.status}）`);
      }
      setOrders((cur) => cur.filter((o) => o.status === "pending"));
      setError(null);
      await fetchList();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(msg || "リセットに失敗しました");
    } finally {
      setConfirmBusy(false);
      setConfirmOpen(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    fetchList();
    fetchStopState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const schedule = (ms: number) => {
      if (timer) clearInterval(timer);
      timer = setInterval(fetchList, ms);
    };
    const onVis = () => {
      if (document.hidden) schedule(60_000);
      else {
        fetchList();
        schedule(5_000);
      }
    };
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    if (!supabase) return;
    let last = 0;
    const trigger = () => {
      const now = Date.now();
      if (now - last > 1000) {
        last = now;
        fetchList();
      }
    };
    const ch = supabase
      .channel("orders-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, trigger)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, trigger)
      .subscribe();
    return () => {
      supabase?.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const grouped = useMemo(() => {
    const pending = orders.filter((o) => o.status === "pending");
    const done = orders.filter((o) => o.status !== "pending");
    return { pending, done };
  }, [orders]);

  const onClickSoundToggle = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next) {
      const a = audioRef.current;
      if (a) {
        a.currentTime = 0;
        a.play().then(() => a.pause()).catch(() => {});
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <audio ref={audioRef} src="/notify.mp3" preload="auto" />

      <header className="sticky top-0 z-10 border-b bg-white md:bg-white/80 md:backdrop-blur">
        <div className="mx-auto max-w-5xl px-3 py-2">
          {/* タイトル行 */}
          <div className="flex items-center gap-3">
            <h1 className="text-lg md:text-xl font-semibold text-gray-900">注文管理</h1>

            {/* ▶ PC用バッジ */}
            <span className="ml-2 hidden md:inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm bg-white text-gray-900">
              未処理 <span className="ml-1 font-bold tabular-nums">{pendingCount}</span>
            </span>

            {/* ▶ モバイル用バッジ（自動縮小） */}
            <span className="ml-2 inline-flex md:hidden items-center rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[clamp(11px,3.2vw,13px)] leading-5 text-gray-900 whitespace-nowrap">
              未処理 <span className="ml-1 font-bold tabular-nums">{pendingCount}</span>
            </span>

            {/* PC: 右寄せコントロール */}
            <div className="ml-auto hidden md:flex items-center gap-2">
              <button
                onClick={onClickSoundToggle}
                className={`rounded-lg px-3 py-1.5 text-sm border ${
                  soundEnabled ? "bg-green-600 text-white" : "bg-white"
                }`}
                title="音のオン/オフ"
              >
                🔔 {soundEnabled ? "音 ON" : "音 OFF"}
              </button>

              <button
                onClick={toggleStop}
                className={`rounded-lg px-3 py-1.5 text-sm border ${
                  isStopped ? "bg-red-600 text-white border-red-600" : "bg-white"
                }`}
                title="注文の受付を停止/再開します"
              >
                {isStopped ? "⛔ 注文STOP中" : "▶︎ 注文受付中"}
              </button>

              <button
                onClick={() => setConfirmOpen(true)}
                className="rounded-lg border px-3 py-1.5 text-sm"
                title="処理済み（完了/キャンセル）を全て削除"
              >
                処理済み削除
              </button>

              <select
                className="rounded-lg border px-3 py-1.5 text-sm bg-white"
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

          {/* スマホ：2段レイアウト */}
          {/* 1段目 */}
          <div className="mt-2 grid grid-cols-3 gap-2 md:hidden">
            <button
              onClick={onClickSoundToggle}
              className={`min-w-0 w-full rounded-lg px-2 py-2 text-[clamp(11px,3.2vw,13px)] leading-5 font-medium border whitespace-nowrap ${
                soundEnabled ? "bg-green-600 text-white" : "bg-white text-gray-900"
              }`}
              title="音のオン/オフ"
            >
              🔔 音{soundEnabled ? " ON" : " OFF"}
            </button>

            <button
              onClick={toggleStop}
              className={`min-w-0 w-full rounded-lg px-2 py-2 text-[clamp(11px,3.2vw,13px)] leading-5 font-medium border whitespace-nowrap ${
                isStopped ? "bg-red-600 text-white border-red-600" : "bg-white text-gray-900"
              }`}
              title="注文の受付を停止/再開します"
            >
              {isStopped ? "⛔ 停止中" : "▶︎ 注文受付"}
            </button>

            <button
              onClick={() => setConfirmOpen(true)}
              className="min-w-0 w-full rounded-lg border px-2 py-2 text-[clamp(11px,3.2vw,13px)] leading-5 font-medium bg-white text-gray-900 whitespace-nowrap"
              title="処理済み（完了/キャンセル）を全て削除"
            >
              処理済み削除
            </button>
          </div>

          {/* 2段目 */}
          <div className="mt-2 grid grid-cols-3 gap-2 md:hidden">
            <select
              className="min-w-0 w-full rounded-lg border px-2 pr-8 py-2 text-[clamp(11px,3.2vw,13px)] leading-5 font-medium bg-white text-gray-900 whitespace-nowrap"
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
              className="min-w-0 w-full rounded-lg border px-2 py-2 text-[clamp(11px,3.2vw,13px)] leading-5 font-medium bg-white text-gray-900 whitespace-nowrap"
              title="更新"
            >
              更新
            </button>

            <button
              onClick={logout}
              className="min-w-0 w-full rounded-lg bg-gray-900 text-white px-2 py-2 text-[clamp(11px,3.2vw,13px)] leading-5 font-medium whitespace-nowrap"
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
            {grouped.pending.length > 0 && (
              <>
                <h2 className="mb-2 text-base md:text-sm font-semibold text-gray-900">未処理</h2>
                <ul className="mb-6 grid gap-3">
                  {grouped.pending.map((o) => (
                    <OrderCard key={o.id} order={o} onUpdate={updateStatus} buzzing={buzzIds.has(o.id)} />
                  ))}
                </ul>
              </>
            )}

            {grouped.done.length > 0 && (
              <>
                <h2 className="mb-2 text-base md:text-sm font-semibold text-gray-900">処理済み</h2>
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

      {/* 確認モーダル */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="w-full max-w-sm md:max-w-md rounded-2xl bg-white p-4 md:p-5 shadow-2xl"
          >
            <h3 id="confirm-title" className="text-base md:text-lg font-semibold text-gray-900 mb-2">
              処理済みの注文を削除しますか？
            </h3>

            <p className="text-sm md:text-[15px] text-gray-700 mb-4 leading-6 break-words">
              「完了」と「キャンセル」の注文をすべて削除します。未処理の注文は残ります。
            </p>

            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={confirmBusy}
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm md:text-base text-gray-700 disabled:opacity-60"
              >
                いいえ
              </button>

              <button
                disabled={confirmBusy}
                onClick={execResetProcessedOnly}
                className="rounded-lg bg-red-600 text-white px-3 py-2 text-sm md:text-base font-medium disabled:opacity-60"
              >
                {confirmBusy ? "削除中…" : "はい、削除する"}
              </button>
            </div>
          </div>
        </div>
      )}
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

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((Date.now() - new Date(order.created_at).getTime()) / 1000);
    }, 1000);
    return () => clearInterval(timer);
  }, [order.created_at]);

  const kfAudioRef = useRef<HTMLAudioElement | null>(null);
  const redNotifiedRef = useRef(false);

  useEffect(() => {
    const audio = kfAudioRef.current;
    if (!audio) return;

    if (order.status === "pending" && elapsed >= 180) {
      if (!redNotifiedRef.current) {
        redNotifiedRef.current = true;
        try {
          audio.currentTime = 0;
          audio.play()?.catch(() => {});
        } catch {}
      }
    } else {
      if (!audio.paused) {
        try { audio.pause(); } catch {}
      }
      if (order.status !== "pending") {
        redNotifiedRef.current = false;
      }
    }
  }, [elapsed, order.status]);

  let highlightClass = "";
  let blinkClass = "";
  if (order.status === "pending") {
    if (elapsed >= 180) {
      highlightClass = "bg-red-50 border-red-300 ring-2 ring-red-400";
      blinkClass = "blink-red-bg";
    } else if (elapsed >= 120) {
      highlightClass = "bg-yellow-50 border-yellow-300";
    }
  }

  return (
    <li
      className={`rounded-2xl border bg-white p-4 shadow-sm transition ${highlightClass} ${blinkClass} ${
        isDone ? "opacity-60" : ""
      } ${buzzing ? "buzz glow" : ""}`}
    >
      <audio ref={kfAudioRef} src="/KF4.mp3" preload="auto" loop />

      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">{order.order_no}</span>
        <span
          className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs border ${
            order.status === "pending"
              ? "bg-yellow-100 border-yellow-300 text-yellow-800"
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
