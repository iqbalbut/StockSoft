import { pageUser } from "@/lib/page-auth";
import { getSettings } from "@/lib/settings";
import { env, isDemo } from "@/lib/env";
import { extractionMode } from "@/extraction/extract";
import { googleConfigured } from "@/ingest/google";
import { dbKind } from "@/db";
import { SettingsForm, TwoFactor, SignOut, PollNow, NotificationSettings } from "@/components/SettingsClient";
import { Webhooks, DigestPanel } from "@/components/Phase2Client";
import { mailConfigured } from "@/lib/mailer";
import { getDb, schema } from "@/db";
import { desc } from "drizzle-orm";

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
  const db = await getDb();
  const endpoints = user.role === "owner" ? (await db.query.webhookEndpoints.findMany({ orderBy: desc(schema.webhookEndpoints.createdAt) })).map(({ secret: _, ...e }) => e) : [];
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <section className="card p-4">
        <h2 className="font-semibold">Routing rules</h2>
        <p className="text-sm muted">Anything below these limits is filed automatically; everything else waits for you in Review.</p>
        <SettingsForm initial={settings} readOnly={user.role !== "owner"} />
      </section>
      <section className="card p-4">
        <h2 className="font-semibold">Books & notifications</h2>
        <NotificationSettings initial={settings} readOnly={user.role !== "owner"} />
        <div className="mt-3 border-t line pt-3">
          <h3 className="mb-2 text-sm font-semibold">Weekly digest</h3>
          <DigestPanel />
          {!mailConfigured() && <p className="mt-2 text-xs text-amber-600">Email isn't configured (SMTP_URL), so the digest goes only to webhooks. Add a webhook below to get it on WhatsApp via n8n.</p>}
        </div>
      </section>
      {user.role === "owner" && (
        <section className="card p-4">
          <h2 className="font-semibold">Outgoing webhooks (n8n, Zapier)</h2>
          <p className="mb-3 text-sm muted">Signed with HMAC-SHA256: header <span className="font-mono">x-receiptvault-signature</span> = sha256 of “timestamp.body”. See docs/DEPLOYMENT.md.</p>
          <Webhooks initial={endpoints} />
        </section>
      )}
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
        <Row label="Email (digest, reminders)" value={mailConfigured() ? "SMTP configured" : "Not configured"} ok={mailConfigured()} />
        <Row label="File storage" value={`${e.STORAGE_DRIVER === "s3" ? `S3 (${e.S3_BUCKET})` : "Local disk"}, AES-256-GCM`} ok />
        <Row label="Database" value={dbKind() === "pglite" ? "Embedded (demo/dev)" : "PostgreSQL"} ok={dbKind() === "postgres"} />
        <Row label="Mode" value={isDemo() ? "Demo" : "Production"} />
        {googleConfigured() && user.role === "owner" && <div className="pt-3"><PollNow /></div>}
      </section>
    </div>
  );
}
