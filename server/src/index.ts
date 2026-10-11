import { config } from './config';
import { buildApp } from './app';
import { openDb } from './db';
import { importIssues } from './data/importIssues';
import { loadAreas, loadPilotAreas } from './data/tiles';
import { RenderQueue } from './queue/renderQueue';
import { CloudWorker, cloudJobStore, processCloudJob } from './queue/cloudWorker';
import { Prerenderer } from './ai/prerender';
import { SnapshotStore } from './ai/snapshots';
import { createClaudeSuggester } from './suggest/claude';
import { setPhotoStatus, setSnapshots, syncAreasAndIssues, uploadSnapshot } from './supabase';


const db = openDb();
const queue = new RenderQueue(db);
// Petition snapshots: kept on this computer, and with Supabase also in Storage and on the request.
const snapshots = config.supabaseEnabled ? new SnapshotStore(uploadSnapshot, setSnapshots) : new SnapshotStore();
const prerender = new Prerenderer(db, undefined, undefined, config.supabaseEnabled ? (s) => setPhotoStatus(s.proposalId, s.status, s.spots) : null, snapshots);
const suggester = config.anthropicKey ? createClaudeSuggester(config.anthropicKey) : null;
const app = await buildApp({ db, queue, prerender, snapshots, suggester });

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(
  `mode=${config.supabaseEnabled ? 'supabase' : 'local-only'} suggestions=${suggester ? 'on' : 'off'} zones=${loadAreas().length}`,
);

// Finish any renders a previous run left behind.
queue.resume();
const cloudWorker = config.supabaseEnabled && config.cloudWorkerEnabled
  ? new CloudWorker(cloudJobStore(), processCloudJob(queue, prerender, snapshots), (m) => app.log.warn(m))
  : null;
cloudWorker?.start();

async function refreshIssues() {
  try {
    const snap = await importIssues();
    if (config.supabaseEnabled) await syncAreasAndIssues(loadPilotAreas(), snap);
  } catch (err) {
    app.log.warn({ err }, 'issue refresh failed; keeping previous data');
  }
}
if (config.supabaseEnabled) void syncAreasAndIssues(loadPilotAreas(), (await import('./data/importIssues')).loadIssues()!).catch((err) => app.log.warn({ err }, 'initial supabase sync failed'));
setInterval(refreshIssues, config.issuesRefreshMs).unref();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await cloudWorker?.stop();
    await app.close();
    process.exit(0);
  });
}
