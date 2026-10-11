#!/usr/bin/env node
// Read-only measurements; no API calls or keys. MB/GB are decimal billing units.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(root, 'server/cache');
const walk = (dir) => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((p) => p.isDirectory() ? walk(path.join(dir, p.name)) : [path.join(dir, p.name)]) : [];
const summarize = (sizes) => {
  const sorted = [...sizes].sort((a, b) => a - b);
  return { count: sorted.length, meanMB: sorted.length ? sizes.reduce((s, n) => s + n, 0) / sizes.length / 1e6 : 0,
    medianMB: sorted.length ? sorted[Math.floor(sorted.length / 2)] / 1e6 : 0,
    maxMB: sorted.length ? sorted.at(-1) / 1e6 : 0 };
};
const modelSets = walk(path.join(cache, 'tiles')).filter((f) => path.basename(f) === 'lod0.glb')
  .map((f) => [0, 1, 2].reduce((s, l) => { const p = path.join(path.dirname(f), `lod${l}.glb`); return s + (existsSync(p) ? statSync(p).size : 0); }, 0));
const edits = [];
const dbPath = path.join(root, 'server/data/server.sqlite');
if (existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const table = db.prepare("select name from sqlite_master where type='table' and name='ai_edits'").get();
    if (table) for (const { url } of db.prepare('select distinct url from ai_edits').all()) {
      if (!String(url).startsWith('/ai/')) continue;
      const f = path.join(cache, String(url).slice(1));
      if (existsSync(f)) edits.push(statSync(f).size);
    }
  } finally { db.close(); }
}
const snapshots = walk(path.join(cache, 'snapshots')).filter((f) => f.endsWith('.jpg')).map((f) => statSync(f).size);
const model = summarize(modelSets), edit = summarize(edits), shot = summarize(snapshots);
// Until actual proposal snapshots exist, use the measured 960x720 JPEG78 sample pack (6 photos,
// 0.674 MB). This is a planning estimate, not a guarantee for every panorama.
const previewMB = shot.count ? shot.meanMB * 6 : 0.674;
const compactMB = model.meanMB + previewMB;
const fullMB = compactMB + edit.meanMB * 15;
console.log(JSON.stringify({ modelSets: model, recordedEdits: edit, savedSnapshots: shot,
  assumptions: { editsPerRequest: 15, imagesPerRequest: 6, previewPackMB: previewMB, snapshotSampleUsed: !shot.count,
    freeStorageGB: 1, freeUncachedEgressGB: 5, freeCachedEgressGB: 5, ngrokFreeEgressGB: 1 },
  estimates: {
    compactRequestMB: compactMB, allEditsRequestMB: fullMB,
    savedRequestsPerFreeGB: Math.floor(1000 / compactMB), allEditRequestsPerFreeGB: Math.floor(1000 / fullMB),
    sixImagePackDownloadsPer5GB: Math.floor(5000 / previewMB), fullDownloadsPerNgrokGB: Math.floor(1000 / fullMB),
  }, sources: ['https://supabase.com/pricing', 'https://supabase.com/docs/guides/platform/manage-your-usage/egress',
    'https://ngrok.com/docs/pricing-limits/free-plan-limits'] }, null, 2));
