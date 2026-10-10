import { z } from 'zod';
import type { ChangeOpType } from './changeOps';

/** A clickable "box" on the map: one ~200 m zone of the worldwide grid (see zones.ts). */
export interface Area {
  id: string; // e.g. "g72975_59640" (older New York pilot zones: "r03c05")
  name: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  issueTotal: number;
  /** Lowest-detail "before" render, once pre-rendered; used to show neighbouring tiles for context. */
  beforeLowUrl?: string;
}

export const ISSUE_CATEGORIES = [
  'street_condition',
  'noise',
  'heat_hot_water',
  'sanitation',
  'traffic_safety',
  'parking',
  'trees_parks',
  'housing_condition',
  'homelessness',
  'other',
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export interface AreaIssue {
  category: IssueCategory;
  count: number;
}

export interface CostLineItem {
  opIndex: number;
  opType: ChangeOpType;
  label: string;
  quantity: number;
  unit: string;
  unitCost: number;
  total: number;
}

export interface CostEstimate {
  items: CostLineItem[];
  subtotal: number;
  contingency: number;
  total: number;
  /** Planning-level range: -30% / +50% of total. */
  low: number;
  high: number;
  currency: 'USD';
}

export const RenderStatus = z.enum(['queued', 'building', 'lod_ready', 'done', 'failed', 'superseded']);
export type RenderStatus = z.infer<typeof RenderStatus>;

export interface RenderJobInfo {
  hash: string;
  status: RenderStatus;
  /** LOD urls relative to server root, available once status is lod_ready/done. lod0 = highest detail. */
  lods: string[];
  error?: string;
}

/** Message pushed over the /ws socket. */
export interface RenderEvent {
  kind: 'render';
  draftId: string | null;
  areaId: string;
  job: RenderJobInfo;
}

export interface Draft {
  id: string;
  areaId: string;
  title: string;
  description: string;
  ops: import('./changeOps').ChangeOp[];
  source: 'human' | 'ai_suggested';
  cost: CostEstimate;
  render: RenderJobInfo | null;
  updatedAt: string;
}

export interface AreaDetail extends Area {
  issues: AreaIssue[];
  /** Where complaint counts come from; null where no open complaint data is available yet. */
  issuesSource: 'nyc311' | null;
  before: RenderJobInfo | null;
  scene: SceneIndex;
}

/** Lightweight, pickable index of things in an area's scene that ops can reference. */
export interface SceneIndex {
  streets: { id: string; name: string; lengthM: number; widthM: number; line: [number, number][] }[];
  buildings: { id: string; heightM: number; footprintM2: number; centroid: [number, number]; ring: [number, number][] }[];
  origin: [number, number];
}

export interface Suggestion {
  title: string;
  rationale: string;
  addresses: IssueCategory[];
  ops: import('./changeOps').ChangeOp[];
  cost: CostEstimate;
}

export const RANK_TIERS = [
  { name: 'Resident', min: 0 },
  { name: 'Advocate', min: 50 },
  { name: 'Organizer', min: 200 },
  { name: 'Council Voice', min: 750 },
] as const;

export function rankFor(points: number): string {
  let name: string = RANK_TIERS[0].name;
  for (const t of RANK_TIERS) if (points >= t.min) name = t.name;
  return name;
}
