import earcut from 'earcut';

export type V2 = [number, number]; // local meters: x = east, y = north
export type RGB = [number, number, number]; // 0..1

/**
 * Accumulates flat-shaded triangles for one material. World space is glTF's:
 * X east, Y up, Z south (so local north `n` maps to z = -n).
 */
export class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  constructor(public readonly vertexColors = false) {}

  get vertexCount() {
    return this.positions.length / 3;
  }

  private vert(x: number, y: number, z: number, n: [number, number, number], c?: RGB) {
    this.positions.push(x, y, z);
    this.normals.push(...n);
    if (this.vertexColors) this.colors.push(...(c ?? [1, 1, 1]));
    return this.vertexCount - 1;
  }

  /** Filled horizontal polygon at height y, facing up. */
  flat(ring: V2[], y: number, c?: RGB) {
    if (ring.length < 3) return;
    const flatCoords = ring.flat();
    const tris = earcut(flatCoords);
    const base = this.vertexCount;
    for (const [x, n] of ring) this.vert(x, y, -n, [0, 1, 0], c);
    // earcut winding depends on input; make every triangle face +Y.
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, d] = [tris[i], tris[i + 1], tris[i + 2]];
      const [ax, an] = ring[a];
      const [bx, bn] = ring[b];
      const [dx, dn] = ring[d];
      // In world XZ (z = -n), a CCW-from-above triangle has positive cross in (x, n) space.
      const cross = (bx - ax) * (dn - an) - (bn - an) * (dx - ax);
      if (cross >= 0) this.indices.push(base + a, base + b, base + d);
      else this.indices.push(base + a, base + d, base + b);
    }
  }

  /** Extruded prism (walls + roof) from y0 to y1. */
  prism(ring: V2[], y0: number, y1: number, c?: RGB, roofColor?: RGB) {
    if (ring.length < 3) return;
    const ccw = signedArea(ring) > 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      const [ax, an] = ccw ? p : q;
      const [bx, bn] = ccw ? q : p;
      const len = Math.hypot(bx - ax, bn - an);
      if (len < 1e-6) continue;
      // Outward normal of a CCW ring edge in (x, n) is (dn, -dx); world z = -n.
      const nx = (bn - an) / len;
      const nn = -(bx - ax) / len;
      const normal: [number, number, number] = [nx, 0, -nn];
      const i0 = this.vert(ax, y0, -an, normal, c);
      const i1 = this.vert(bx, y0, -bn, normal, c);
      const i2 = this.vert(bx, y1, -bn, normal, c);
      const i3 = this.vert(ax, y1, -an, normal, c);
      this.indices.push(i0, i1, i2, i0, i2, i3);
    }
    this.flat(ring, y1, roofColor ?? c);
  }

  box(cx: number, cn: number, w: number, d: number, y0: number, h: number, headingRad = 0, c?: RGB) {
    const cos = Math.cos(headingRad);
    const sin = Math.sin(headingRad);
    const corners: V2[] = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(([u, v]) => [cx + u * cos - v * sin, cn + u * sin + v * cos]);
    this.prism(corners, y0, y0 + h, c);
  }

  /** Low-poly "octahedron" blob, used for tree canopies. */
  blob(cx: number, cy: number, cn: number, r: number, c?: RGB) {
    const top: [number, number, number] = [cx, cy + r, -cn];
    const bot: [number, number, number] = [cx, cy - r * 0.6, -cn];
    const center: [number, number, number] = [cx, cy + r * 0.1, -cn];
    const ring: [number, number, number][] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * r, cy, -(cn + Math.sin(a) * r)]);
    }
    for (let k = 0; k < 6; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % 6];
      this.tri(a, b, top, center, c);
      this.tri(b, a, bot, center, c);
    }
  }

  /** Triangle oriented to face away from `center` (for convex shapes). */
  private tri(
    a: [number, number, number],
    b: [number, number, number],
    d: [number, number, number],
    center: [number, number, number],
    c?: RGB,
  ) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n: [number, number, number] = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const out = [(a[0] + b[0] + d[0]) / 3 - center[0], (a[1] + b[1] + d[1]) / 3 - center[1], (a[2] + b[2] + d[2]) / 3 - center[2]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) {
      [b, d] = [d, b];
      n = [-n[0], -n[1], -n[2]];
    }
    const len = Math.hypot(...n) || 1;
    n = [n[0] / len, n[1] / len, n[2] / len];
    const i0 = this.vert(...a, n, c);
    const i1 = this.vert(...b, n, c);
    const i2 = this.vert(...d, n, c);
    this.indices.push(i0, i1, i2);
  }

  /** Flat strip following a polyline, offset sideways from it. */
  ribbon(line: V2[], width: number, y: number, offset = 0, c?: RGB) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, an] = line[i];
      const [bx, bn] = line[i + 1];
      const len = Math.hypot(bx - ax, bn - an);
      if (len < 1e-6) continue;
      // Left-hand perpendicular (in x,n) of the direction a→b.
      const px = -(bn - an) / len;
      const pn = (bx - ax) / len;
      const o1 = offset - width / 2;
      const o2 = offset + width / 2;
      this.flat(
        [
          [ax + px * o1, an + pn * o1],
          [bx + px * o1, bn + pn * o1],
          [bx + px * o2, bn + pn * o2],
          [ax + px * o2, an + pn * o2],
        ],
        y,
        c,
      );
    }
  }
}

export function signedArea(ring: V2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Douglas–Peucker on a closed ring; always keeps at least 3 points. */
export function simplifyRing(ring: V2[], tol: number): V2[] {
  if (ring.length <= 4) return ring;
  const dp = (pts: V2[]): V2[] => {
    let maxD = 0;
    let idx = 0;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    for (let i = 1; i < pts.length - 1; i++) {
      const d = segDist(pts[i], a, b);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD <= tol) return [a, b];
    return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))];
  };
  // Split the ring at its farthest point from vertex 0 so DP has two open chains.
  let far = 1;
  for (let i = 1; i < ring.length; i++) if (dist(ring[i], ring[0]) > dist(ring[far], ring[0])) far = i;
  const out = [...dp(ring.slice(0, far + 1)).slice(0, -1), ...dp([...ring.slice(far), ring[0]]).slice(0, -1)];
  return out.length >= 3 ? out : ring;
}

const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function segDist(p: V2, a: V2, b: V2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

export function pointInRing(p: V2, ring: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function ringCentroid(ring: V2[]): V2 {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

/** Points spaced evenly along a polyline, with the local heading at each. */
export function pointsAlong(line: V2[], spacing: number, inset = spacing / 2): { p: V2; heading: number }[] {
  const out: { p: V2; heading: number }[] = [];
  let carry = inset;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, an] = line[i];
    const [bx, bn] = line[i + 1];
    const len = Math.hypot(bx - ax, bn - an);
    const heading = Math.atan2(bn - an, bx - ax);
    let t = carry;
    for (; t <= len; t += spacing) out.push({ p: [ax + ((bx - ax) * t) / len, an + ((bn - an) * t) / len], heading });
    carry = t - len;
  }
  return out;
}

/** Offset a polyline sideways (left positive), segment-wise. */
export function offsetLine(line: V2[], offset: number): V2[] {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / len) * offset, p[1] + ((b[0] - a[0]) / len) * offset];
  });
}

/** Deterministic PRNG so the same ops always produce the same scene (and cache hash). */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
