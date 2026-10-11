/**
 * Snapshots of a request, for its petition: small still images that the phone app shows in the
 * Feed, so a petition loads without the live Street View or 3D model. They're taken by the same
 * hidden Chrome that prepares the photo-real views (see prerender.ts): the 3D model ones as soon
 * as the model loads, the Street View ones once the spot nearest the change is photo-real.
 *
 * Files: cache/snapshots/{proposalId}/{kind}.jpg, listed in index.json beside them. With Supabase
 * connected they're also uploaded to Storage and listed on the request (proposals.snapshots).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config';

export const SHOT_KINDS = ['after', 'closeup', 'street', 'before', 'top', 'angled'] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];

export const SHOT_LABELS: Record<ShotKind, string> = {
  after: 'Street View · after',
  closeup: 'Close-up',
  street: 'Down the street',
  before: 'Street View · before',
  top: '3D model · top',
  angled: '3D model · angled',
};

export interface Snapshot {
  kind: ShotKind;
  label: string;
  /** A /snapshots/… path on this server, or a full Supabase Storage URL. */
  url: string;
}

export interface SnapshotSet {
  status: 'none' | 'running' | 'done' | 'failed';
  shots: Snapshot[];
  error?: string;
}

/** Where a saved snapshot should also go (Supabase Storage); returns its public URL. */
export type ShareShot = (proposalId: string, kind: ShotKind, jpeg: Buffer) => Promise<string>;
/** Told the full list whenever it changes (e.g. to list it on the request in Supabase). */
export type ShotsChanged = (proposalId: string, shots: Snapshot[]) => Promise<void> | void;

// Request ids are UUIDs (Supabase and local-only); anything else never names a folder.
const ID_RE = /^[0-9a-f-]{8,64}$/i;
const root = () => path.join(config.cacheDir, 'snapshots');
const dirFor = (id: string) => {
  if (!ID_RE.test(id)) throw new Error(`bad request id ${id}`);
  return path.join(root(), id);
};

export class SnapshotStore {
  constructor(private share: ShareShot | null = null, private changed: ShotsChanged | null = null) {}

  get(proposalId: string): SnapshotSet {
    if (!ID_RE.test(proposalId)) return { status: 'none', shots: [] };
    const file = path.join(dirFor(proposalId), 'index.json');
    if (!existsSync(file)) return { status: 'none', shots: [] };
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as SnapshotSet;
    } catch {
      return { status: 'none', shots: [] };
    }
  }

  private put(proposalId: string, set: SnapshotSet) {
    const dir = dirFor(proposalId);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'index.json');
    writeFileSync(`${file}.tmp`, JSON.stringify(set));
    renameSync(`${file}.tmp`, file);
  }

  start(proposalId: string) {
    this.put(proposalId, { status: 'running', shots: this.get(proposalId).shots });
  }

  finish(proposalId: string, error?: string) {
    const cur = this.get(proposalId);
    // Some pictures are better than none: only a run that saved nothing counts as failed.
    this.put(proposalId, { status: error && !cur.shots.length ? 'failed' : 'done', shots: cur.shots, ...(error ? { error } : {}) });
  }

  async save(proposalId: string, kind: ShotKind, jpeg: Buffer): Promise<Snapshot> {
    const dir = dirFor(proposalId);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${kind}.jpg`);
    writeFileSync(`${file}.tmp`, jpeg);
    renameSync(`${file}.tmp`, file);
    const url = this.share ? await this.share(proposalId, kind, jpeg) : `/snapshots/${proposalId}/${kind}.jpg`;
    const shot: Snapshot = { kind, label: SHOT_LABELS[kind], url };
    const cur = this.get(proposalId);
    // Keep the design's order (after, close-up, street, before, 3D top, 3D angled), whatever order they arrive in.
    const shots = [...cur.shots.filter((s) => s.kind !== kind), shot].sort((a, b) => SHOT_KINDS.indexOf(a.kind) - SHOT_KINDS.indexOf(b.kind));
    this.put(proposalId, { status: cur.status === 'none' ? 'running' : cur.status, shots });
    if (this.changed) await Promise.resolve(this.changed(proposalId, shots)).catch((err) => console.warn(`snapshots not shared: ${(err as Error).message}`));
    return shot;
  }
}
