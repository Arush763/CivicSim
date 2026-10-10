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
