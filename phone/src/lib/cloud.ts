import { DraftInput, DraftPatch, type Area, type AreaDetail, type Draft } from '@mamdani/shared';
import { supabase } from './supabase';
import type { SnapshotSet } from './api';

interface CloudDraft {
  id: string;
  area_id: string;
  title: string;
  description: string;
  ops: Draft['ops'];
  updated_at: string;
}
const client = () => {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
};
const draft = (row: CloudDraft): Draft => ({
  id: row.id, areaId: row.area_id, title: row.title, description: row.description, ops: row.ops,
  source: 'human', updatedAt: row.updated_at,
  // Costs and models are calculated after submission. The phone saves only small change data.
  cost: { items: [], subtotal: 0, contingency: 0, total: 0, low: 0, high: 0, currency: 'USD' }, render: null,
});

export async function cloudAreas(): Promise<Area[]> {
  const { data, error } = await client().from('areas').select('id,name,bbox,issue_total').limit(1000);
  if (error) throw new Error(error.message);
  return data.map((a) => ({ id: a.id, name: a.name, bbox: a.bbox, issueTotal: a.issue_total }));
}

/** Known zones work when the laptop is asleep. A new zone is fetched by the same durable worker. */
export async function cloudArea(id: string): Promise<AreaDetail> {
  const read = async () => {
    const { data, error } = await client().from('zone_scenes').select('detail').eq('area_id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.detail as AreaDetail | undefined;
  };
  const saved = await read();
  if (saved) return saved;
  const { error } = await client().rpc('request_zone', { p_area_id: id });
  if (error) throw new Error(error.message);
  // Bound the wait: callers can retry later instead of keeping an endless loading screen.
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const detail = await read();
    if (detail) return detail;
  }
  throw new Error('This zone is queued for loading. Try again once the processing computer is online.');
}

export async function cloudDrafts(areaId?: string): Promise<Draft[]> {
  let q = client().from('request_drafts').select('*').is('submitted_at', null).order('updated_at', { ascending: false });
  if (areaId) q = q.eq('area_id', areaId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data.map(draft);
}
export async function cloudDraft(id: string): Promise<Draft> {
  const { data, error } = await client().from('request_drafts').select('*').eq('id', id).is('submitted_at', null).single();
  if (error) throw new Error(error.message);
  return draft(data);
}
export async function createCloudDraft(input: Parameters<typeof DraftInput.parse>[0]): Promise<Draft> {
  const value = DraftInput.parse(input);
  const { data, error } = await client().from('request_drafts').insert({
    area_id: value.areaId, title: value.title, description: value.description, ops: value.ops,
  }).select('*').single();
  if (error) throw new Error(error.message);
  return draft(data);
}
export async function updateCloudDraft(id: string, patch: Parameters<typeof DraftPatch.parse>[0]): Promise<Draft> {
  const value = DraftPatch.parse(patch);
  // Source is always human; cost, owner and output URLs cannot be set by a client.
  const { data, error } = await client().from('request_drafts').update({
    ...(value.title !== undefined ? { title: value.title } : {}),
    ...(value.description !== undefined ? { description: value.description } : {}),
    ...(value.ops !== undefined ? { ops: value.ops } : {}), updated_at: new Date().toISOString(),
  }).eq('id', id).is('submitted_at', null).select('*').single();
  if (error) throw new Error(error.message);
  return draft(data);
}
export async function deleteCloudDraft(id: string): Promise<void> {
  const { error } = await client().from('request_drafts').delete().eq('id', id).is('submitted_at', null);
  if (error) throw new Error(error.message);
}
export async function submitCloudDraft(id: string): Promise<{ proposalId: string; mode: 'supabase'; afterUrls: string[] }> {
  const { data, error } = await client().rpc('submit_request', { p_draft_id: id });
  if (error) throw new Error(error.message);
  return { proposalId: data, mode: 'supabase', afterUrls: [] };
}
export async function cloudSnapshots(id: string): Promise<SnapshotSet> {
  const { data, error } = await client().from('proposals').select('snapshots,processing_status').eq('id', id).single();
  if (error) throw new Error(error.message);
  return {
    status: data.processing_status === 'ready' ? 'done' : data.processing_status === 'failed' ? 'failed' : 'running',
    shots: data.snapshots ?? [],
  };
}
