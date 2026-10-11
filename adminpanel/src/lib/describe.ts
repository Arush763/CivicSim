import type { AreaDetail } from '@mamdani/shared';
import { ISSUE_LABELS } from './theme';

/** Plain-language description of a zone from its streets, buildings and recent 311 complaints. */
export function describeArea(a: AreaDetail): string {
  const byLength = new Map<string, number>();
  for (const s of a.scene.streets) byLength.set(s.name, (byLength.get(s.name) ?? 0) + s.lengthM);
  const streets = [...byLength.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n).slice(0, 4);
  const heights = a.scene.buildings.map((b) => b.heightM).sort((x, y) => x - y);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const tall = heights.filter((h) => h > 60).length;
  const character =
    median < 15 ? 'mostly low-rise' : median < 30 ? 'mostly mid-rise' : 'dense and tall';

  // Zones are a fixed grid; measure this one rather than assuming a size.
  const [w, so, e, n] = a.bbox;
  const sizeM = Math.round(((n - so) * 111_195) / 10) * 10;
  const widthM = Math.round(((e - w) * 111_195 * Math.cos((((so + n) / 2) * Math.PI) / 180)) / 10) * 10;
  const parts = [
    streets.length ? `A block of about ${widthM} × ${sizeM} m around ${listJoin(streets)}.` : `A block of about ${widthM} × ${sizeM} m with no mapped streets.`,
    `${a.scene.buildings.length} buildings, ${character}${tall ? `, with ${tall} tower${tall === 1 ? '' : 's'} over 60 m` : ''}.`,
  ];
  const total = a.issues.reduce((s, i) => s + i.count, 0);
  if (!a.issuesSource) {
    parts.push("Complaint data like New York's 311 isn't available for this area yet.");
  } else if (total > 0) {
    const top = a.issues.slice(0, 3).map((i) => `${(ISSUE_LABELS[i.category] ?? i.category).toLowerCase()} (${i.count})`);
    parts.push(`Residents made ${total.toLocaleString()} complaints to 311 in the last 90 days, mostly about ${listJoin(top)}.`);
  } else {
    parts.push('No 311 complaints recorded here in the last 90 days.');
  }
  return parts.join(' ');
}

function listJoin(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
