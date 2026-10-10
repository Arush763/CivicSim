import { CHANGE_OP_LABELS, M2_PER_FT2, M_PER_MILE, type ChangeOp, type CostEstimate, type CostLineItem } from '@mamdani/shared';
import { newBuildingHeight } from '../scene/build';
import { pointInRing } from '../scene/geometry';
import type { LocalTile } from '../scene/local';
import { CONTINGENCY, GROSS_SQFT_PER_UNIT, RANGE, UNIT_COSTS as U } from './unitCosts';

const FT_PER_M = 1 / 0.3048;
const sides = (s: 'left' | 'right' | 'both') => (s === 'both' ? 2 : 1);
const floorsOf = (heightM: number) => Math.max(1, Math.round(heightM / 3.2));

/**
 * Rule-based cost estimate. Quantities come from the tile geometry, never from an AI,
 * so the same ops always cost the same whether a person or a suggestion produced them.
 */
export function estimate(ops: ChangeOp[], lt: LocalTile): CostEstimate {
  const items: CostLineItem[] = [];
  const street = (id: string) => lt.streets.find((s) => s.id === id);
  const push = (opIndex: number, op: ChangeOp, label: string, quantity: number, unit: string, unitCost: number) => {
    if (quantity <= 0) return;
    const q = Math.round(quantity * 100) / 100;
    items.push({ opIndex, opType: op.type, label, quantity: q, unit, unitCost, total: Math.round(q * unitCost) });
  };

  ops.forEach((op, i) => {
    switch (op.type) {
      case 'add_bike_lane': {
        const s = street(op.streetSegmentId);
        if (!s) return;
        const miles = (s.lengthM / M_PER_MILE) * sides(op.side);
        push(i, op, `${op.protected ? 'Protected' : 'Painted'} bike lane, ${s.name}`, miles, 'lane-mile',
          op.protected ? U.bikeLaneProtectedPerMile : U.bikeLanePaintedPerMile);
        return;
      }
      case 'add_bus_lane': {
        const s = street(op.streetSegmentId);
        if (!s) return;
        push(i, op, `Bus lane, ${s.name}`, (s.lengthM / M_PER_MILE) * sides(op.side), 'lane-mile', U.busLanePerMile);
        return;
      }
      case 'widen_sidewalk': {
        const s = street(op.streetSegmentId);
        if (!s) return;
        // Widening applies to both curbs of the segment.
        const sqft = (s.lengthM * op.meters * 2) / M2_PER_FT2;
        push(i, op, `Sidewalk extension, ${s.name}`, sqft, 'sq ft', U.sidewalkPerSqFt);
        push(i, op, `Curb relocation, ${s.name}`, s.lengthM * 2 * FT_PER_M, 'linear ft', U.curbRelocationPerFt);
        return;
      }
      case 'remove_parking': {
        const s = street(op.streetSegmentId);
        if (!s) return;
        push(i, op, `Parking removal signage, ${s.name}`, Math.max(1, s.lengthM / 100) * sides(op.side), 'block side',
          U.parkingRemovalPerBlockSide);
        return;
      }
      case 'plant_trees':
        push(i, op, 'Street trees', op.count, 'tree', U.streetTree);
        return;
      case 'add_crosswalk':
        push(i, op, op.raised ? 'Raised crosswalk' : 'High-visibility crosswalk', 1, 'each',
          op.raised ? U.crosswalkRaised : U.crosswalk);
        return;
      case 'add_park': {
        const ring = op.polygon.map(lt.toLocal);
        const area = Math.abs(ring.reduce((a, p, k) => {
          const q = ring[(k + 1) % ring.length];
          return a + p[0] * q[1] - q[0] * p[1];
        }, 0)) / 2;
        push(i, op, op.name ? `Park: ${op.name}` : 'New park', area / M2_PER_FT2, 'sq ft', U.parkPerSqFt);
        const cleared = lt.buildings.filter((b) => pointInRing(b.centroid, ring));
        const floorArea = cleared.reduce((t, b) => t + b.areaM2 * floorsOf(b.heightM), 0);
        push(i, op, `Clear ${cleared.length} existing structure(s)`, floorArea / M2_PER_FT2, 'sq ft floor area',
          U.demolitionPerSqFt);
        return;
      }
      case 'replace_building': {
        const b = lt.buildings.find((x) => x.id === op.buildingId);
        if (!b) return;
        push(i, op, 'Demolish existing building', (b.areaM2 * floorsOf(b.heightM)) / M2_PER_FT2, 'sq ft floor area',
          U.demolitionPerSqFt);
        const gsf = (b.areaM2 * op.floors) / M2_PER_FT2;
        if (op.use === 'affordable_housing') {
          const units = op.units || Math.floor(gsf / GROSS_SQFT_PER_UNIT);
          push(i, op, `${units} affordable homes (${op.floors} floors)`, units, 'unit', U.affordableUnit);
        } else {
          push(i, op, `${CHANGE_OP_LABELS[op.type]}: ${op.use.replace(/_/g, ' ')} (${op.floors} floors, ${newBuildingHeight(op.floors).toFixed(0)} m)`,
            gsf, 'gross sq ft', U.buildingPerSqFt[op.use]);
        }
        return;
      }
    }
  });

  const subtotal = items.reduce((t, x) => t + x.total, 0);
  const contingency = Math.round(subtotal * CONTINGENCY);
  const total = subtotal + contingency;
  return {
    items,
    subtotal,
    contingency,
    total,
    low: Math.round(total * RANGE.low),
    high: Math.round(total * RANGE.high),
    currency: 'USD',
  };
}
