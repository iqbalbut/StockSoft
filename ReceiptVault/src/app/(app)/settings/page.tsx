import { pageUser } from "@/lib/page-auth";
import { getSettings } from "@/lib/settings";
import { env, isDemo } from "@/lib/env";
import { extractionMode } from "@/extraction/extract";
import { googleConfigured } from "@/ingest/google";
import { dbKind } from "@/db";
import { SettingsForm, TwoFactor, SignOut, PollNow } from "@/components/SettingsClient";

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="muted">{label}</span>
      <span className="flex items-center gap-2">{ok != null && <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-400"}`} />}{value}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const user = await pageUser();
  const settings = await getSettings();
  const e = env();
  const mode = extractionMode();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <section className="card p-4">
        <h2 className="font-semibold">Routing rules</h2>
        <p className="text-sm muted">Anything below these limits is filed automatically; everything else waits for you in Review.</p>
        <SettingsForm initial={settings} readOnly={user.role !== "owner"} />
      </section>
      <section className="card p-4">
        <h2 className="font-semibold">Security</h2>
        <Row label="Signed in as" value={`${user.email} (${user.role})`} />
        <TwoFactor enabled={user.totpEnabled} />
        <SignOut />
      </section>
      <section className="card divide-y line p-4">
        <h2 className="pb-2 font-semibold">Connections</h2>
        <Row label="AI extraction" value={mode === "claude" ? e.EXTRACTION_MODEL : mode === "mock" ? "Demo (sample data)" : "Not configured"} ok={mode === "claude"} />
        <Row label="Gmail label" value={googleConfigured() ? `"${e.GMAIL_LABEL}" every ${e.INGEST_POLL_MINUTES} min` : "Not connected"} ok={googleConfigured()} />
        <Row label="Drive folder" value={googleConfigured() && e.DRIVE_FOLDER_ID ? "Watching" : "Not connected"} ok={googleConfigured() && !!e.DRIVE_FOLDER_ID} />
        <Row label="Webhook intake (n8n / WhatsApp)" value={e.INGEST_API_KEY ? "/api/ingest/webhook" : "Set INGEST_API_KEY"} ok={!!e.INGEST_API_KEY} />
        <Row label="File storage" value={`${e.STORAGE_DRIVER === "s3" ? `S3 (${e.S3_BUCKET})` : "Local disk"}, AES-256-GCM`} ok />
        <Row label="Database" value={dbKind() === "pglite" ? "Embedded (demo/dev)" : "PostgreSQL"} ok={dbKind() === "postgres"} />
        <Row label="Mode" value={isDemo() ? "Demo" : "Production"} />
        {googleConfigured() && user.role === "owner" && <div className="pt-3"><PollNow /></div>}
      </section>
    </div>
  );
}
