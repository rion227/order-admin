// app/admin/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      if (!res.ok || !json.ok) throw new Error(json.error || "ログインに失敗しました");
      router.replace("/admin");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f6f7f8"}}>
      <form onSubmit={onSubmit} style={{background:"#fff",padding:24,borderRadius:16,boxShadow:"0 4px 20px rgba(0,0,0,.06)",width:320}}>
        <h1 style={{fontSize:18,fontWeight:600,marginBottom:12}}>管理ログイン</h1>
        <label style={{display:"block",fontSize:12,color:"#555"}}>パスワード</label>
        <input
          type="password"
          value={password}
          onChange={(e)=>setPassword(e.target.value)}
          required
          style={{width:"100%",padding:"10px 12px",border:"1px solid #d0d5dd",borderRadius:10,marginTop:6}}
        />
        {err && <p style={{color:"#b42318",background:"#fee4e2",border:"1px solid #fecdca",padding:8,borderRadius:8,marginTop:8,fontSize:12}}>{err}</p>}
        <button disabled={loading} style={{width:"100%",marginTop:12,background:"#111",color:"#fff",padding:"10px 12px",borderRadius:10}}>
          {loading ? "確認中…" : "ログイン"}
        </button>
      </form>
    </div>
  );
}
