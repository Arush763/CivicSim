/**
 * Pull the last 90 days of 311 complaints in the pilot area and count them per tile and category.
 * Run on its own (`npm run import:issues`) or hourly from the server.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AreaIssue, IssueCategory } from '@mamdani/shared';
import { config } from '../config';
import { categorize } from './issueCategories';
import { DATASETS, soql } from './socrata';
import { areasFile, loadPilotAreas, makeGrid } from './tiles';

const LOOKBACK_DAYS = 90;
export const issuesFile = () => path.join(config.dataDir, 'issues.json');

export interface IssuesSnapshot {
  updatedAt: string;
  since: string;
  byArea: Record<string, AreaIssue[]>;
}

export function loadIssues(): IssuesSnapshot | null {
  return existsSync(issuesFile()) ? JSON.parse(readFileSync(issuesFile(), 'utf8')) : null;
}

export async function importIssues(): Promise<IssuesSnapshot> {
  const [w, s, e, n] = config.pilotBbox;
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 19);
  console.log(`fetching 311 complaints since ${since}…`);
  const rows = await soql<{ complaint_type: string; latitude: string; longitude: string }>(
    DATASETS.complaints311,
    {
      $select: 'complaint_type, latitude, longitude',
      $where: `created_date > '${since}' AND borough='MANHATTAN' AND latitude between ${s} and ${n} AND longitude between ${w} and ${e}`,
    },
    50_000,
  );

  const grid = makeGrid(config.pilotBbox, config.tileSizeM);
  const counts = new Map<string, Map<IssueCategory, number>>();
  for (const r of rows) {
    const id = grid.tileFor([Number(r.longitude), Number(r.latitude)]);
    if (!id) continue;
    const cat = categorize(r.complaint_type);
    const m = counts.get(id) ?? new Map();
    m.set(cat, (m.get(cat) ?? 0) + 1);
    counts.set(id, m);
  }

  const areas = loadPilotAreas();
  const byArea: Record<string, AreaIssue[]> = {};
  for (const a of areas) {
    const m = counts.get(a.id) ?? new Map();
    byArea[a.id] = [...m.entries()].map(([category, count]) => ({ category, count })).sort((x, y) => y.count - x.count);
    a.issueTotal = byArea[a.id].reduce((t, i) => t + i.count, 0);
  }
  const snap: IssuesSnapshot = { updatedAt: new Date().toISOString(), since, byArea };
  writeFileSync(issuesFile(), JSON.stringify(snap));
  writeFileSync(areasFile(), JSON.stringify(areas, null, 2));
  console.log(`  ${rows.length} complaints across ${areas.length} areas`);
  return snap;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  importIssues().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
