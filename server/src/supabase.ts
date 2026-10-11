import { readFileSync } from 'node:fs';
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

const adminCache = new Map<string, { admin: boolean; expires: number }>();

/** Whether a user is a city admin (profiles.role), cached for a minute. */
export async function isAdmin(userId: string): Promise<boolean> {
  const hit = adminCache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.admin;
  const { data, error } = await supabase().from('profiles').select('role').eq('id', userId).maybeSingle();
  if (error) throw new Error(`profile: ${error.message}`);
  const admin = data?.role === 'admin';
  adminCache.set(userId, { admin, expires: Date.now() + 60_000 });
  return admin;
}

/** Upload a render's LOD files to Storage; returns public URLs, highest detail first. */
export async function uploadRender(areaId: string, hash: string): Promise<string[]> {
  const urls: string[] = [];
  for (const lod of [0, 1, 2]) {
    const key = `${areaId}/${hash}/lod${lod}.glb`;
    const body = readFileSync(path.join(config.cacheDir, 'tiles', key));
    const { error } = await supabase().storage.from('renders').upload(key, body, { contentType: 'model/gltf-binary', upsert: true });
    if (error) throw new Error(`upload ${key}: ${error.message}`);
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
