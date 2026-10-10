/**
 * Complaint counts for a zone. New York City publishes its 311 complaints openly, so zones in
 * the city get live counts; elsewhere there's no shared source yet and the list is empty.
 */
import { isZoneId, type AreaIssue, type AreaDetail, type IssueCategory } from '@mamdani/shared';
import { loadIssues } from './importIssues';
import { categorize } from './issueCategories';
import { DATASETS, soql } from './socrata';

const LOOKBACK_DAYS = 90;
const TTL_MS = 60 * 60 * 1000;
/** Rough box around the five boroughs. */
const NYC: [number, number, number, number] = [-74.26, 40.49, -73.69, 40.92];

const cache = new Map<string, { at: number; issues: AreaIssue[] }>();

export const inNyc = ([w, s, e, n]: [number, number, number, number]) => e > NYC[0] && w < NYC[2] && n > NYC[1] && s < NYC[3];

export async function zoneIssues(id: string, bbox: [number, number, number, number]): Promise<Pick<AreaDetail, 'issues' | 'issuesSource'>> {
  if (!isZoneId(id)) return { issues: loadIssues()?.byArea[id] ?? [], issuesSource: 'nyc311' }; // pilot grid snapshot
  if (!inNyc(bbox)) return { issues: [], issuesSource: null };
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return { issues: hit.issues, issuesSource: 'nyc311' };

  const [w, s, e, n] = bbox;
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 19);
  try {
    const rows = await soql<{ complaint_type: string; n: string }>(DATASETS.complaints311, {
      $select: 'complaint_type, count(*) as n',
      $where: `created_date > '${since}' AND latitude between ${s} and ${n} AND longitude between ${w} and ${e}`,
      $group: 'complaint_type',
      $order: 'complaint_type',
    });
    const counts = new Map<IssueCategory, number>();
    for (const r of rows) {
      const cat = categorize(r.complaint_type);
      counts.set(cat, (counts.get(cat) ?? 0) + Number(r.n));
    }
    const issues = [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
    cache.set(id, { at: Date.now(), issues });
    return { issues, issuesSource: 'nyc311' };
  } catch {
    // 311 being slow shouldn't stop the zone from opening; show what we had, if anything.
    return { issues: hit?.issues ?? [], issuesSource: 'nyc311' };
  }
}
