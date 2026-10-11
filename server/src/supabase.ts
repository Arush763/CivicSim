import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Area, CostEstimate, ChangeOp, ProposalSource } from '@mamdani/shared';
import { config } from './config';
import type { IssuesSnapshot } from './data/importIssues';

let client: SupabaseClient | null = null;

/** Service-role client. The key never leaves the PC; the phone only ever sees the anon key. */
export function supabase(): SupabaseClient {
  if (!config.supabaseEnabled) throw new Error('Supabase is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)');
  client ??= createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false } });
  return client;
}

const tokenCache = new Map<string, { userId: string; expires: number }>();

/** Resolve a Supabase access token to a user id (cached for a few minutes). */
export async function userIdForToken(token: string): Promise<string | null> {
  const hit = tokenCache.get(token);
  if (hit && hit.expires > Date.now()) return hit.userId;
  const { data, error } = await supabase().auth.getUser(token);
  if (error || !data.user) return null;
  tokenCache.set(token, { userId: data.user.id, expires: Date.now() + 5 * 60_000 });
  return data.user.id;
}

/** The name shown on requests and ranks: "First Last", numbered if someone already has it. */
async function freeUsername(name: string): Promise<string> {
  const base = name.replace(/\s+/g, ' ').trim().slice(0, 28);
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${base} ${n}`;
    const { data } = await supabase().from('profiles').select('id').eq('username', candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${base} ${randomBytes(2).readUInt16BE() % 9000 + 1000}`;
}

/**
 * A new phone-app account, already confirmed, so Supabase sends no email (its built-in sender
 * allows only a few an hour). The app signs in with the password straight after.
 */
export async function createAccount(a: { email: string; password: string; firstName: string; lastName: string }): Promise<void> {
  const username = await freeUsername(`${a.firstName} ${a.lastName}`);
  const { error } = await supabase().auth.admin.createUser({
    email: a.email,
    password: a.password,
    email_confirm: true,
    user_metadata: { username, first_name: a.firstName, last_name: a.lastName },
  });
  if (error) throw error;
}

let cityAdmin: Promise<string> | undefined;

/**
 * The account the admin panel acts as (the panel has no sign-in): the first city admin
 * (profiles.role), or a new "City admin" account if there is none yet.
 */
export function cityAdminId(): Promise<string> {
  cityAdmin ??= (async () => {
    const sb = supabase();
    const { data: found, error } = await sb.from('profiles').select('id').eq('role', 'admin').order('created_at').limit(1).maybeSingle();
    if (error) throw new Error(`city admin: ${error.message}`);
    if (found) return found.id as string;
    const { data, error: e2 } = await sb.auth.admin.createUser({
      email: 'city-admin@civicsim.local',
      password: randomBytes(24).toString('base64url'), // never used: nobody signs in as this account
      email_confirm: true,
      user_metadata: { username: 'City admin', first_name: 'City', last_name: 'admin' },
    });
    if (e2) throw new Error(`city admin: ${e2.message}`);
    const { error: e3 } = await sb.from('profiles').update({ role: 'admin' }).eq('id', data.user.id);
    if (e3) throw new Error(`city admin: ${e3.message}`);
    return data.user.id;
  })().catch((e) => {
    cityAdmin = undefined;
    throw e;
  });
  return cityAdmin;
}

/** Upload a render's LOD files to Storage; returns public URLs, highest detail first. */
export async function uploadRender(areaId: string, hash: string): Promise<string[]> {
  const urls: string[] = [];
  for (const lod of [0, 1, 2]) {
    const key = `${areaId}/${hash}/lod${lod}.glb`;
    const body = readFileSync(path.join(config.cacheDir, 'tiles', key));
    // The scene hash is immutable. A retry must not overwrite the same model or invalidate CDN caches.
    const { error } = await supabase().storage.from('renders').upload(key, body, { contentType: 'model/gltf-binary', cacheControl: '31536000', upsert: false });
    if (error && !('statusCode' in error && String(error.statusCode) === '409')) throw new Error(`upload ${key}: ${error.message}`);
    urls.push(supabase().storage.from('renders').getPublicUrl(key).data.publicUrl);
  }
  return urls;
}

export async function uploadThumbnail(areaId: string, hash: string, png: Buffer): Promise<string> {
  const key = `${areaId}/${hash}/thumb.png`;
  const { error } = await supabase().storage.from('renders').upload(key, png, { contentType: 'image/png', upsert: true });
  if (error) throw new Error(`upload ${key}: ${error.message}`);
  return supabase().storage.from('renders').getPublicUrl(key).data.publicUrl;
}

/**
 * A photo-real edit (see ai/streetRender.ts), into public Storage, so everyone loads it from
 * Supabase's CDN, fast and whether or not the laptop is on. Its name carries a hash of its content,
 * so an edit made again never collides with a cached older one. Returns the public URL.
 */
export async function uploadAiEdit(file: string): Promise<string> {
  const body = readFileSync(path.join(config.cacheDir, 'ai', file));
  const key = `ai/${file.replace(/\.png$/, '')}-${createHash('sha1').update(body).digest('hex').slice(0, 10)}.png`;
  const { error } = await supabase().storage.from('renders').upload(key, body, { contentType: 'image/png', cacheControl: '31536000', upsert: false });
  if (error && !('statusCode' in error && String(error.statusCode) === '409')) throw new Error(`upload ${key}: ${error.message}`);
  return supabase().storage.from('renders').getPublicUrl(key).data.publicUrl;
}

/** A petition snapshot (see ai/snapshots.ts), into public Storage; returns its URL. */
export async function uploadSnapshot(proposalId: string, kind: string, jpeg: Buffer): Promise<string> {
  const digest = createHash('sha256').update(jpeg).digest('hex').slice(0, 20);
  const key = `snapshots/${proposalId}/${kind}-${digest}.jpg`;
  const { error } = await supabase().storage.from('renders').upload(key, jpeg, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
  if (error && !('statusCode' in error && String(error.statusCode) === '409')) throw new Error(`upload ${key}: ${error.message}`);
  return supabase().storage.from('renders').getPublicUrl(key).data.publicUrl;
}

/** The snapshots a request has so far, listed on it so the app can offer them for its petition. */
export async function setSnapshots(proposalId: string, shots: { kind: string; label: string; url: string }[]) {
  const { error } = await supabase().from('proposals').update({ snapshots: shots }).eq('id', proposalId);
  if (error) throw new Error(`snapshots: ${error.message}`);
}

export interface ProposalInsert {
  area_id: string;
  author_id: string;
  title: string;
  description: string;
  ops: ChangeOp[];
  cost: CostEstimate;
  source: ProposalSource;
  before_url: string | null;
  after_url: string;
  thumb_url: string | null;
}

/** The fields needed to prepare a request's photo-real views. */
export async function getProposal(id: string): Promise<{ id: string; area_id: string; ops: ChangeOp[]; after_url: string } | null> {
  const { data, error } = await supabase().from('proposals').select('id, area_id, ops, after_url').eq('id', id).maybeSingle();
  if (error) throw new Error(`get proposal: ${error.message}`);
  return data;
}

/** An admin's decision on a request (the server checks the admin; the database only takes it from here). */
export async function setProposalStatus(id: string, status: string) {
  const { error } = await supabase().from('proposals').update({ status }).eq('id', id);
  if (error) throw new Error(`set status: ${error.message}`);
}

/** How far along a request's photo-real views are, for any app to show (see prerender.ts). */
export async function setPhotoStatus(proposalId: string, status: string, spots: number) {
  const { error } = await supabase()
    .from('proposals')
    .update({ photo_status: status, photo_spots: spots, photo_updated_at: new Date().toISOString() })
    .eq('id', proposalId);
  if (error) throw new Error(`photo status: ${error.message}`);
}

export async function insertProposal(p: ProposalInsert): Promise<{ id: string }> {
  const { data, error } = await supabase().from('proposals').insert(p).select('id').single();
  if (error) throw new Error(`insert proposal: ${error.message}`);
  return data;
}

export async function upsertArea(a: Area) {
  const { error } = await supabase().from('areas').upsert({ id: a.id, name: a.name, bbox: a.bbox, issue_total: a.issueTotal });
  if (error) throw new Error(`upsert area: ${error.message}`);
}

/** Push the area list and latest 311 counts so the app can read them straight from Supabase. */
export async function syncAreasAndIssues(areas: Area[], snap: IssuesSnapshot) {
  const sb = supabase();
  const { error: e1 } = await sb.from('areas').upsert(areas.map((a) => ({ id: a.id, name: a.name, bbox: a.bbox, issue_total: a.issueTotal })));
  if (e1) throw new Error(`sync areas: ${e1.message}`);
  const rows = Object.entries(snap.byArea).flatMap(([area_id, issues]) =>
    issues.map((i) => ({ area_id, category: i.category, count: i.count, updated_at: snap.updatedAt })),
  );
  const { error: e2 } = await sb.from('area_issues').upsert(rows);
  if (e2) throw new Error(`sync issues: ${e2.message}`);
}
