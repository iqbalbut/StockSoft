"use client";
import { useState } from "react";
import type { AppSettings } from "@/lib/settings";

export function SettingsForm({ initial, readOnly }: { initial: AppSettings; readOnly: boolean }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState("");
  const field = (key: keyof AppSettings, label: string, hint: string, opts: { step?: number; scale?: number } = {}) => (
    <label className="block py-2 text-sm">
      <span className="flex justify-between"><span>{label}</span><span className="muted">{hint}</span></span>
      <input
        className="input mt-1"
        type="number"
        step={opts.step ?? 1}
        disabled={readOnly}
        value={Number(s[key]) * (opts.scale ?? 1)}
        onChange={(e) => setS({ ...s, [key]: Number(e.target.value) / (opts.scale ?? 1) })}
      />
    </label>
  );
  async function save() {
    const res = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
    const data = await res.json();
    setMsg(res.ok ? "Saved" : data.issues?.[0]?.message ?? data.error);
  }
  return (
    <div>
      {field("autoApproveConfidence", "Auto-approve confidence (%)", "every key field must reach this", { scale: 100 })}
      {field("reviewAmountUsd", "Always review above (USD)", "0 = no limit", { step: 10 })}
      {field("duplicateDayWindow", "Duplicate window (days)", "same vendor + amount")}
      {field("duplicateAmountTolerancePct", "Duplicate amount tolerance (%)", "", { step: 0.5 })}
      {field("retentionYears", "Retention (years)", "minimum 7")}
      {!readOnly && <button className="btn btn-primary mt-2" onClick={save}>Save rules</button>}
      {msg && <span className="ml-3 text-sm muted">{msg}</span>}
      <p className="mt-2 text-xs muted">New rules apply to documents processed from now on. Use “Re-read” on a record to re-route it.</p>
    </div>
  );
}

export function TwoFactor({ enabled }: { enabled: boolean }) {
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  async function start() {
    const data = await (await fetch("/api/auth/totp")).json();
    setSetup(data);
  }
  async function submit(action: "enable" | "disable") {
    const res = await fetch("/api/auth/totp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, action }) });
    if (!res.ok) return setMsg((await res.json()).error);
    window.location.href = action === "disable" ? "/login" : "/settings";
  }
  if (enabled) {
    return (
      <div className="py-2 text-sm">
        <div className="flex items-center justify-between"><span className="muted">Two-factor authentication</span><span className="text-emerald-500">On</span></div>
        <div className="mt-2 flex gap-2">
          <input className="input" inputMode="numeric" placeholder="Current code to turn off" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn btn-ghost" onClick={() => submit("disable")}>Turn off</button>
        </div>
        {msg && <p className="mt-1 text-rose-500">{msg}</p>}
      </div>
    );
  }
  return (
    <div className="py-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="muted">Two-factor authentication</span>
        {!setup && <button className="btn btn-primary" onClick={start}>Turn on</button>}
      </div>
      {setup && (
        <div className="mt-3 space-y-2">
          <p>Scan with Google Authenticator, 1Password or Authy, then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="2FA QR code" className="rounded-lg bg-white p-2" width={200} height={200} />
          <p className="font-mono text-xs break-all muted">{setup.secret}</p>
          <div className="flex gap-2">
            <input className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn btn-primary" onClick={() => submit("enable")}>Verify</button>
          </div>
          {msg && <p className="text-rose-500">{msg}</p>}
        </div>
      )}
    </div>
  );
}

export function SignOut() {
  return (
    <button
      className="btn btn-ghost mt-2 w-full"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
    >
      Sign out
    </button>
  );
}

export function PollNow() {
  const [msg, setMsg] = useState("");
  return (
    <div className="flex items-center gap-3">
      <button
        className="btn btn-ghost"
        onClick={async () => {
          const res = await fetch("/api/ingest/poll", { method: "POST" });
          setMsg(res.ok ? "Checking Gmail/Drive in the background…" : (await res.json()).error);
        }}
      >
        Check Gmail / Drive now
      </button>
      <span className="text-sm muted">{msg}</span>
    </div>
  );
}
