/**
 * Unit costs for planning-level estimates, in 2026 USD.
 *
 * These are ORDER-OF-MAGNITUDE placeholders for NYC-scale public works, chosen to be in a
 * plausible range. They are NOT sourced figures yet: each one must be checked against NYC DOT /
 * Parks / HPD capital budget documents before the numbers are shown to anyone as real.
 * Keep every number here so there is one place to audit and update.
 */
export const UNIT_COSTS = {
  /** Paint + flex posts + signal changes, per mile per side. VERIFY. */
  bikeLanePaintedPerMile: 250_000,
  /** Parking-protected lane with concrete islands at intersections, per mile per side. VERIFY. */
  bikeLaneProtectedPerMile: 1_500_000,
  /** Red thermoplastic + signage + camera enforcement, per mile per side. VERIFY. */
  busLanePerMile: 300_000,
  /** Tree + pit + two years of establishment care. VERIFY against NYC Parks. */
  streetTree: 3_500,
  /** Design + construction of a small urban park, per sq ft. VERIFY. */
  parkPerSqFt: 250,
  /** Demolition + abatement of existing structures, per sq ft of floor area. VERIFY. */
  demolitionPerSqFt: 20,
  /** Total development cost per affordable housing unit. VERIFY against HPD term sheets. */
  affordableUnit: 600_000,
  /** Hard + soft cost per gross sq ft by building use. VERIFY. */
  buildingPerSqFt: {
    mixed_use: 750,
    community_center: 900,
    school: 1_000,
    clinic: 1_100,
  },
  /** Concrete sidewalk extension, per sq ft. VERIFY. */
  sidewalkPerSqFt: 60,
  /** Moving the curb line (drainage, curb, catch basins), per linear ft. VERIFY. */
  curbRelocationPerFt: 350,
  /** High-visibility thermoplastic crosswalk. VERIFY. */
  crosswalk: 5_000,
  /** Raised crosswalk (speed table) incl. drainage. VERIFY. */
  crosswalkRaised: 40_000,
  /** Signage + marking changes to remove parking, per block side (~100 m). VERIFY. */
  parkingRemovalPerBlockSide: 1_500,
} as const;

export const CONTINGENCY = 0.2;
/** Planning-level accuracy band (AACE class 5 style): -30% / +50%. */
export const RANGE = { low: 0.7, high: 1.5 } as const;
/** Typical gross sq ft per affordable unit incl. common areas, used when units aren't given. */
export const GROSS_SQFT_PER_UNIT = 950;
