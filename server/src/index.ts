import { config } from './config';
import { buildApp } from './app';
import { openDb } from './db';
import { importIssues } from './data/importIssues';
import { loadAreas, loadPilotAreas } from './data/tiles';
import { RenderQueue } from './queue/renderQueue';
import { Prerenderer } from './ai/prerender';
import { createClaudeSuggester } from './suggest/claude';
import { setPhotoStatus, syncAreasAndIssues } from './supabase';


const db = openDb();
const queue = new RenderQueue(db);
const prerender = new Prerenderer(db, undefined, undefined, config.supabaseEnabled ? (s) => setPhotoStatus(s.proposalId, s.status, s.spots) : null);
const suggester = config.anthropicKey ? createClaudeSuggester(config.anthropicKey) : null;
const app = await buildApp({ db, queue, prerender, suggester });

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(
  `mode=${config.supabaseEnabled ? 'supabase' : 'local-only'} suggestions=${suggester ? 'on' : 'off'} zones=${loadAreas().length}`,
);

// Finish any renders a previous run left behind.
queue.resume();

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
    await app.close();
    process.exit(0);
  });
}
