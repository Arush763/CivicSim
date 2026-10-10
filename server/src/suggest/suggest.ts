import type { AreaIssue, Suggestion } from '@mamdani/shared';
import type { TileData } from '../data/tiles';

/** Produces candidate changes for a person to review. Never submits anything itself. */
export interface Suggester {
  suggest(tile: TileData, issues: AreaIssue[]): Promise<Suggestion[]>;
}
