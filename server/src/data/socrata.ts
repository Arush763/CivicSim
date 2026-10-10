/** Tiny client for NYC Open Data (Socrata SODA 2.1). */

const BASE = 'https://data.cityofnewyork.us/resource';

export const DATASETS = {
  buildings: '5zhs-2jue', // Building Footprints
  centerline: 'inkn-q76z', // Street Centerline (CSCL)
  parks: 'enfh-gkve', // Parks Properties
  complaints311: 'erm2-nwe9', // 311 Service Requests
  boroughs: 'gthc-hcne', // Borough Boundaries (shoreline-clipped)
  neighborhoods: '9nt8-h7nd', // 2020 Neighborhood Tabulation Areas
} as const;

export async function soql<T>(dataset: string, params: Record<string, string>, pageSize = 5000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const qs = new URLSearchParams({ ...params, $limit: String(pageSize), $offset: String(offset), $order: params.$order ?? ':id' });
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (process.env.NYC_APP_TOKEN) headers['X-App-Token'] = process.env.NYC_APP_TOKEN;
    const page = await fetchWithRetry<T[]>(`${BASE}/${dataset}.json?${qs}`, headers);
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}

async function fetchWithRetry<T>(url: string, headers: Record<string, string>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(90_000) });
      if (res.ok) return (await res.json()) as T;
      const body = (await res.text()).slice(0, 300);
      // 4xx other than rate limiting means the query itself is wrong: don't retry.
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`Socrata ${res.status}: ${body}`), { fatal: true });
      if (i >= attempts) throw new Error(`Socrata ${res.status} after ${i} attempts: ${body}`);
    } catch (err) {
      if ((err as { fatal?: boolean }).fatal || i >= attempts) throw err;
      console.warn(`  socrata attempt ${i} failed (${(err as Error).message}); retrying`);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
}

/** SoQL within_box takes (north-west lat, lng, south-east lat, lng). */
export function withinBox(column: string, bbox: [number, number, number, number]): string {
  const [w, s, e, n] = bbox;
  return `within_box(${column}, ${n}, ${w}, ${s}, ${e})`;
}
