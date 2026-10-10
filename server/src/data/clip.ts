/** Sutherland–Hodgman clip of a polygon ring against an axis-aligned bbox. */
export function clipRingToBbox(
  ring: [number, number][],
  [w, s, e, n]: [number, number, number, number],
): [number, number][] {
  type P = [number, number];
  const edges: { inside: (p: P) => boolean; cut: (a: P, b: P) => P }[] = [
    { inside: (p) => p[0] >= w, cut: (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[0] <= e, cut: (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[1] >= s, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s] },
    { inside: (p) => p[1] <= n, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n] },
  ];
  let out: P[] = ring;
  for (const edge of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (edge.inside(cur)) {
        if (!edge.inside(prev)) out.push(edge.cut(prev, cur));
        out.push(cur);
      } else if (edge.inside(prev)) {
        out.push(edge.cut(prev, cur));
      }
    }
    if (out.length === 0) break;
  }
  return out;
}
