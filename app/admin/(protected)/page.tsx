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

// 安全に JSON を読む（空や非 JSON なら {}）
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
  const audioRef = useRef<HTMLAudioElement | null>(null); // 通常通知音（音ON時のみ）
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

  // リセット実行（処理済み＝完了/キャンセルのみ削除）
  async function execResetProcessedOnly() {
    setConfirmBusy(true);
    try {
      const r = await fetch("/api/orders/reset", {
        method: "POST",
        credentials: "include",
      });
      const j = (await safeJson(r)) as any;
      if (!r.ok || j?.ok === false) {
        throw new Error(j?.error || `リセットに失敗しました（HTTP ${r.status}）`);
      }
      // 表示側の一時リセット（未処理は残す）
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

  // 初回＆フィルタ変更時に取得
  useEffect(() => {
    setLoading(true);
    fetchList();
    fetchStopState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // 前面5秒 / 背景60秒
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

  // Realtime
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
      {/* 通常通知音（新規入荷時のピロン）。音ON時のみ鳴動 */}
      <audio ref={audioRef} src="/notify.mp3" preload="auto" />

      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
          <h1 className="text-xl font-semibold">注文管理</h1>

          <span className="ml-2 inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm">
            未処理 <span className="ml-1 font-bold">{pendingCount}</span>
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClickSoundToggle}
              className={`rounded-lg px-3 py-1.5 text-sm border ${
                soundEnabled ? "bg-green-600 text-white" : "bg-white"
              }`}
              title="音のオン/オフ"
            >
              🔔 {soundEnabled ? "音 ON" : "音 OFF"}
            </button>

            {/* 注文停止 */}
            <button
              onClick={toggleStop}
              className={`rounded-lg px-3 py-1.5 text-sm border ${
                isStopped ? "bg-red-600 text-white border-red-600" : "bg-white"
              }`}
              title="注文の受付を停止/再開します"
            >
              {isStopped ? "⛔ 注文STOP中" : "▶︎ 注文受付中"}
            </button>

            {/* 処理済みをサーバー側で削除する本リセット（確認あり） */}
            <button
              onClick={() => setConfirmOpen(true)}
              className="rounded-lg border px-3 py-1.5 text-sm"
              title="処理済み（完了/キャンセル）を全て削除"
            >
              処理済みクリア
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
            {grouped.pending.length > 0 && (
              <>
                <h2 className="mb-2 text-sm font-semibold text-gray-600">未処理</h2>
                <ul className="mb-6 grid gap-3">
                  {grouped.pending.map((o) => (
                    <OrderCard key={o.id} order={o} onUpdate={updateStatus} buzzing={buzzIds.has(o.id)} />
                  ))}
                </ul>
              </>
            )}

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

      {/* ページ内に残しておく（buzz/glow）。点滅はglobals.cssへ */}
      <style jsx global>{`
        @keyframes buzz {
          0% { transform: translate3d(0, 0, 0); }
          25% { transform: translate3d(-2px, 0, 0); }
          50% { transform: translate3d(2px, 0, 0); }
          75% { transform: translate3d(-1px, 0, 0); }
          100%{ transform: translate3d(0, 0, 0); }
        }
        .buzz { animation: buzz 0.6s linear 2; }
        .glow { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.35); }
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

  // 経過時間（秒）を1秒ごとに更新
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((Date.now() - new Date(order.created_at).getTime()) / 1000);
    }, 1000);
    return () => clearInterval(timer);
  }, [order.created_at]);

  // 3分到達で KF4.mp3 を一度だけ再生（ループ）。通知ON/OFF無視
  const kfAudioRef = useRef<HTMLAudioElement | null>(null);
  const redNotifiedRef = useRef(false);

  // 赤になった瞬間に再生、完了/キャンセルになったら停止
  useEffect(() => {
    const audio = kfAudioRef.current;
    if (!audio) return;

    if (order.status === "pending" && elapsed >= 180) {
      if (!redNotifiedRef.current) {
        redNotifiedRef.current = true;
        try {
          audio.currentTime = 0;
          // ループは属性で設定済み。強制再生（自動再生ポリシーの影響を受ける場合あり）
          audio.play()?.catch(() => {});
        } catch {}
      }
    } else {
      // まだ赤ではない、またはpending以外になったら止める
      if (!audio.paused) {
        try { audio.pause(); } catch {}
      }
      if (order.status !== "pending") {
        redNotifiedRef.current = false; // 完了/キャンセル後に再度pendingで戻るケースに備えてリセット
      }
    }
  }, [elapsed, order.status]);

  // 経過時間による色付け＆点滅
  let highlightClass = "";
  let blinkClass = "";
  if (order.status === "pending") {
    if (elapsed >= 180) {
      highlightClass = "bg-red-50 border-red-300 ring-2 ring-red-400";
      blinkClass = "blink-red";
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
      {/* 3分アラート用の隠しオーディオ（ループ） */}
      <audio ref={kfAudioRef} src="/KF4.mp3" preload="auto" loop />

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
