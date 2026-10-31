"use client";
import { useState } from "react";

type Mode = "login" | "setup";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.issues?.[0]?.message ?? data.error ?? "Something went wrong");
  return data;
}

export function AuthForm({ mode, demoHint }: { mode: Mode; demoHint?: { email: string; password: string } }) {
  const [step, setStep] = useState<"password" | "mfa">("password");
  const [email, setEmail] = useState(demoHint?.email ?? "");
  const [password, setPassword] = useState(demoHint?.password ?? "");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (step === "mfa") await post("/api/auth/mfa", { code });
      else if (mode === "setup") await post("/api/auth/setup", { email, name, password });
      else {
        const r = await post("/api/auth/login", { email, password });
        if (r.mfa) {
          setStep("mfa");
          return;
        }
      }
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 font-bold text-white">RV</span>
        <div>
          <h1 className="font-semibold">{mode === "setup" ? "Create the owner account" : step === "mfa" ? "Two-factor code" : "Sign in"}</h1>
          <p className="text-xs muted">AiNetworks LLC · ReceiptVault</p>
        </div>
      </div>
      {step === "mfa" ? (
        <input className="input text-center text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" />
      ) : (
        <>
          {mode === "setup" && <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />}
          <input className="input" type="email" autoComplete="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" type="password" autoComplete={mode === "setup" ? "new-password" : "current-password"} placeholder={mode === "setup" ? "Password (12+ characters)" : "Password"} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </>
      )}
      {error && <p className="text-sm text-rose-500">{error}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? "…" : step === "mfa" ? "Verify" : mode === "setup" ? "Create account" : "Sign in"}</button>
      {demoHint && step === "password" && <p className="text-center text-xs muted">Demo account pre-filled: {demoHint.email}</p>}
    </form>
  );
}
