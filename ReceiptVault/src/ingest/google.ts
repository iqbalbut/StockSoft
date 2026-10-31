import { env } from "@/lib/env";

let token: { value: string; expires: number } | null = null;

export const googleConfigured = () => {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.GOOGLE_REFRESH_TOKEN);
};

/** OAuth access token from the long-lived refresh token (see docs/DEPLOYMENT.md → Google). */
export async function googleToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const e = env();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: e.GOOGLE_CLIENT_ID!,
      client_secret: e.GOOGLE_CLIENT_SECRET!,
      refresh_token: e.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return token.value;
}

export async function gfetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${await googleToken()}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Google API ${res.status} for ${url.split("?")[0]}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
