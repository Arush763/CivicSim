/**
 * Gemini image editing through Vertex AI (Google Cloud), billed to the Cloud project — and so to
 * its Free Trial credit — instead of an AI Studio key. Vertex doesn't take plain API keys, so the
 * server signs in as a service account using its JSON key file (server/vertex-key.json, which git
 * ignores). No Google SDK needed: the token exchange is a signed JWT (RFC 7523).
 */
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

export function loadServiceAccount(file: string): ServiceAccount | null {
  if (!file || !existsSync(file)) return null;
  const sa = JSON.parse(readFileSync(file, 'utf8')) as Partial<ServiceAccount>;
  return sa.client_email && sa.private_key && sa.project_id ? (sa as ServiceAccount) : null;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

let cached: { token: string; until: number; who: string } | null = null;

/** A short-lived OAuth access token for the service account (cached until a minute before it expires). */
export async function accessToken(sa: ServiceAccount, fetchFn: typeof fetch = fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.who === sa.client_email && cached.until > now + 60) return cached.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }),
  );
  const signature = b64url(createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key));
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`Google sign-in for Vertex AI failed: ${json.error_description ?? res.status}`);
  cached = { token: json.access_token, until: now + (json.expires_in ?? 3600), who: sa.client_email };
  return json.access_token;
}

export interface VertexImage {
  mime: string;
  data: string; // base64
}

/** How the server signs in to Vertex: a service-account key file, or an API key bound to one. */
export type VertexAuth = { sa: ServiceAccount } | { apiKey: string; project: string };

/** Ask a Gemini image model on Vertex AI to edit images per the prompt; returns the raw response JSON. */
export async function vertexGenerate(
  auth: VertexAuth,
  opts: { model: string; location: string; prompt: string; images: VertexImage[]; aspect: string; size?: string },
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const project = 'sa' in auth ? auth.sa.project_id : auth.project;
  const authHeader: Record<string, string> = 'sa' in auth ? { authorization: `Bearer ${await accessToken(auth.sa, fetchFn)}` } : { 'x-goog-api-key': auth.apiKey };
  const host = opts.location === 'global' ? 'aiplatform.googleapis.com' : `${opts.location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${project}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: opts.prompt }, ...opts.images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } }))] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: opts.aspect, ...(opts.size ? { imageSize: opts.size } : {}) } },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}
