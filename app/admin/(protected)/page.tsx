// app/admin/(protected)/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/** 注文1件の型 */
type Order = {
  id: string;
  order_no: string;
  items: { id: string; name: string; qty: number; price?: number }[];
  note?: string | null;
  status: "pending" | "completed" | "cancelled";
  created_at: string;
  updated_at: string;
};

/** 一覧APIの返却型 */
type ListResp = {
  ok: boolean;
  items: Order[];
  total_count: number;
  pending_count: number;
  error?: string;
};

type StatusFilter = "" | "pending" | "completed" | "cancelled";

/* ------------------------------
   Supabase（ブラウザ）初期化
   env が揃っていてクライアント側なら生成
-------------------------------- */
let supabase: SupabaseClient | null = null;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (typeof window !== "undefined" && SUPABASE_URL && SUPABASE_ANON) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
}

/** APIレスポンスを安全にJSON化（空や非JSONなら {} を返す） */
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

  // 画面状態
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [error, setError] = useState<string | null>(null);

  // ===== 通知関連 =====
  const audioRef = useRef<HTMLAudioElement | null>(null); // 新規入荷ピロン音（音ON時のみ鳴る）
  const [soundEnabled, setSoundEnabled] = useState(false);
  const knownPendingIds = useRef<Set<string>>(new Set()); // 直近に見えていた未処理ID集合
  const initialized = useRef(false);
  const [buzzIds, setBuzzIds] = useState<Set<string>>(new Set()); // 揺れ/発光を与えるID

  // STOPトグル（注文受付の停止/再開）
  const [isStopped, setIsStopped] = useState(false);

  // 処理済みクリア確認モーダル
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  /** 音ONのときだけ通常通知音を再生 */
  const playNotify = () => {
    if (!soundEnabled) return;
    const a = audioRef.current;
    if (!a) return;
    try {
      a.currentTime = 0;
      a.play()?.catch(() => {});
    } catch {}
  };

  /** 新規未処理が来たとき：音＋バイブ＋一時的に揺れ/発光 */
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

  /* =========================
     API: 一覧取得＆新規検知
     - フィルタ付きで取得
     - 未処理IDの差分で“新着”を検知
  ========================== */
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

      // 初回は差分通知しない。2回目以降で“新規”を検知して通知
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

  /** ステータス更新（楽観更新→失敗時ロールバック） */
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
      setOrders(prev); // 失敗したら元に戻す
      const msg = e instanceof Error ? e.message : String(e);
      alert(msg || "更新に失敗しました");
    }
  }

  /** ログアウトしてログイン画面へ */
  async function logout() {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    router.replace("/admin/login");
  }

  /** STOP状態の取得（起動時に同期） */
  async function fetchStopState() {
    try {
      const r = await fetch("/api/admin/stop", { cache: "no-store", credentials: "include" });
      const j = (await safeJson(r)) as any;
      if (j?.ok) setIsStopped(!!j.stopped);
    } catch {}
  }

  /** STOPトグル（POST） */
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

  /** 処理済み（完了/キャンセル）だけを全削除 */
  async function execResetProcessedOnly() {
    setConfirmBusy(true);
    try {
      const r = await fetch("/api/orders/reset", { method: "POST", credentials: "include" });
      const j = (await safeJson(r)) as any;
      if (!r.ok || j?.ok === false) {
        throw new Error(j?.error || `リセットに失敗しました（HTTP ${r.status}）`);
      }
      // 表示側は未処理だけ残す → 直後に fetchList で最新同期
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

  /* 起動時 & フィルタ変更時に一覧取得＋STOP状態同期 */
  useEffect(() => {
    setLoading(true);
    fetchList();
    fetchStopState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  /* ポーリング：前面5秒/バックグラウンド60秒 */
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

  /* Realtime(Supabase) : INSERT/UPDATE で最大1秒間隔の再取得 */
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

  /** 表示用：未処理/処理済みの2群に分割 */
  const grouped = useMemo(() => {
    const pending = orders.filter((o) => o.status === "pending");
    const done = orders.filter((o) => o.status !== "pending");
    return { pending, done };
  }, [orders]);

  /** ヘッダーの音ON/OFF */
  const onClickSoundToggle = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    // ONにした瞬間だけ自動再生許可のため一瞬再生→停止
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
      {/* 新規入荷のピロン音（音ON時のみ使用） */}
      <audio ref={audioRef} src="/notify.mp3" preload="auto" />

      {/* ===== ヘッダー：PCは横一列、スマホは2段 ===== */}
      <header className="sticky top-0 z-10 border-b bg-white md:bg-white/80 md:backdrop-blur">
        <div className="mx-auto max-w-5xl px-3 py-2">
          {/* タイトル行（左:タイトル/未処理数, 右:PC用操作群） */}
          <div className="flex items-center gap-3">
            <h1 className="text-lg md:text-xl font-semibold text-gray-900">注文管理</h1>

            {/* PC用の未処理バッジ（固定サイズ） */}
            <span className="ml-2 hidden md:inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm bg-white text-gray-900">
              未処理 <span className="ml-1 font-bold tabular-nums">{pendingCount}</span>
            </span>

            {/* モバイル用の未処理バッジ（clamp で自動縮小） */}
            <span className="ml-2 inline-flex md:hidden items-center rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[clamp(11px,3.2vw,13px)] leading-5 text-gray-900 whitespace-nowrap">
              未処理 <span className="ml-1 font-bold tabular-nums">{pendingCount}</span>
            </span>

            {/* PC: 右寄せの操作群（スマホでは非表示） */}
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

              {/* 注文受付 STOP/再開 */}
              <button
                onClick={toggleStop}
                className={`rounded-lg px-3 py-1.5 text-sm border ${
                  isStopped ? "bg-red-600 text-white border-red-600" : "bg-white"
                }`}
                title="注文の受付を停止/再開します"
              >
                {isStopped ? "⛔ 注文STOP中" : "▶︎ 注文受付中"}
              </button>

              {/* 処理済みクリア（確認モーダル表示） */}
              <button
                onClick={() => setConfirmOpen(true)}
                className="rounded-lg border px-3 py-1.5 text-sm"
                title="処理済み（完了/キャンセル）を全て削除"
              >
                処理済みクリア
              </button>

              {/* ステータスフィルタ */}
              <div className="relative">
                <select
                  className="rounded-lg border pl-3 pr-9 py-1.5 text-sm bg-white appearance-none"
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
                {/* ▼ 矢印（SVG）。クリックはselectに届くように pointer-events-none */}
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-gray-700">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 011.08 1.04l-4.25 4.25a.75.75 0 01-1.06 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                  </svg>
                </span>
              </div>


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

          {/* スマホ: 2段の操作UI（各ボタンは自動縮小＋nowrap） */}
          {/* 1段目：音 / 注文受付 / 処理済みクリア */}
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

          {/* 2段目：すべて / 更新 / ログアウト */}
          <div className="mt-2 grid grid-cols-3 gap-2 md:hidden">
            <div className="relative">
              <select
                className="min-w-0 w-full rounded-lg border pl-2 pr-9 py-2 text-[clamp(11px,3.2vw,13px)] leading-5 font-medium bg-white text-gray-900 whitespace-nowrap appearance-none"
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
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-gray-700">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 011.08 1.04l-4.25 4.25a.75.75 0 01-1.06 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </span>
            </div>


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
                {/* 見出しはモバイル少し大きく＆濃色 */}
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

      {/* ===== 処理済みクリアの確認モーダル ===== */}
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

/* =======================
   注文カード：経過時間で強調
   - 2分→黄背景
   - 3分→赤背景“点滅”＋KF4.mp3 ループ再生（音設定に関係なく）
======================= */
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

  // 経過秒を1秒ごとに更新（created_at 起点）
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((Date.now() - new Date(order.created_at).getTime()) / 1000);
    }, 1000);
    return () => clearInterval(timer);
  }, [order.created_at]);

  // 3分で赤化時にだけ鳴らすループ音（通知ON/OFFを無視）
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
          audio.play()?.catch(() => {}); // loop は要素属性で指定
        } catch {}
      }
    } else {
      // pending以外/または3分未満に戻ったら停止
      if (!audio.paused) {
        try { audio.pause(); } catch {}
      }
      if (order.status !== "pending") {
        redNotifiedRef.current = false;
      }
    }
  }, [elapsed, order.status]);

  // 経過時間に応じた見た目（赤は bg をアニメで点滅）
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
      {/* 3分時の自動ループ音（/public/KF4.mp3） */}
      <audio ref={kfAudioRef} src="/KF4.mp3" preload="auto" loop />

      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">{order.order_no}</span>

        {/* ステータスバッジ（未処理は少し濃い黄） */}
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
