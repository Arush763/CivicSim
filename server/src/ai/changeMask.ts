/**
 * Where an AI edit actually changed the photo. Compares the edit with the original Street View
 * image (after matching the edit's overall colour to the original, so a slight tint shift doesn't
 * count), and returns the edit as a PNG whose transparency is "unchanged": the viewer then shows
 * Google's full-resolution panorama everywhere except where something was really built or removed.
 */
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

interface Rgba {
  width: number;
  height: number;
  data: Uint8Array | Buffer;
}

function decode(buf: Buffer): Rgba {
  if (buf[0] === 0x89 && buf[1] === 0x50) return PNG.sync.read(buf);
  return jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
}

/** Bilinear resize to w × h (RGBA). */
function resize(src: Rgba, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1.001, Math.max(0, ((y + 0.5) * src.height) / h - 0.5));
    const y0 = Math.floor(sy), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1.001, Math.max(0, ((x + 0.5) * src.width) / w - 0.5));
      const x0 = Math.floor(sx), fx = sx - x0;
      for (let c = 0; c < 4; c++) {
        const p = (yy: number, xx: number) => src.data[(yy * src.width + xx) * 4 + c];
        out[(y * w + x) * 4 + c] = (p(y0, x0) * (1 - fx) + p(y0, x0 + 1) * fx) * (1 - fy) + (p(y0 + 1, x0) * (1 - fx) + p(y0 + 1, x0 + 1) * fx) * fy;
      }
    }
  }
  return out;
}

/** Box blur of a single-channel image (separable, radius r). */
function blur(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(a.length);
  const out = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / (2 * r + 1);
      s += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / (2 * r + 1);
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Number each 4-connected patch of set pixels (0 = not set). */
function labelPatches(on: Float32Array, w: number, h: number): Int32Array {
  const label = new Int32Array(w * h);
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!on[start] || label[start]) continue;
    label[start] = ++next;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q >= 0 && q < w * h && on[q] && !label[q]) {
          label[q] = next;
          stack.push(q);
        }
      }
    }
  }
  return label;
}

/**
 * `guideBuf` (the 3D placement guide, black where nothing was planned) limits the mask to the
 * changes that touch the planned change: Gemini also redraws untouched facades slightly
 * differently, and those should keep Google's sharper original.
 */
/** Edits are kept at most this wide: about Google's own sharpness for a 120° view, and phone-friendly. */
const MAX_SIZE = 1536;

export function maskEdit(originalBuf: Buffer, editedBuf: Buffer, guideBuf?: Buffer): { png: Buffer; changed: number; onPlan: number | null } {
  const full = decode(editedBuf);
  const scale = Math.min(1, MAX_SIZE / Math.max(full.width, full.height));
  const w = Math.round(full.width * scale);
  const h = Math.round(full.height * scale);
  const ed = scale < 1 ? resize(full, w, h) : Float32Array.from(full.data);
  const orig = resize(decode(originalBuf), w, h);

  // Match the edit's overall colour to the original (per-channel gain).
  const gain = [0, 1, 2].map((c) => {
    let so = 0, se = 0;
    for (let i = c; i < orig.length; i += 4) {
      so += orig[i];
      se += ed[i];
    }
    return se > 0 ? so / se : 1;
  });

  // Difference, smoothed so JPEG noise and tiny shifts don't count.
  const diff = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(orig[p * 4 + c] - ed[p * 4 + c] * gain[c]);
    diff[p] = d;
  }
  const smooth = blur(diff, w, h, 3);
  // Changed where clearly different.
  const hard = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) if (smooth[p] > 55) hard[p] = 1;
  // How much of the planned change the edit actually changed (null without a guide).
  let onPlan: number | null = null;
  // Keep only changes that touch the planned change (everything, if there's no guide). Each
  // changed patch is kept or dropped whole: Gemini often draws a tree a little bigger or to one
  // side of the guide, and cutting at a fixed distance sliced it in half. Patches that don't touch
  // the plan (facades and cars Gemini redrew slightly differently) keep Google's original.
  if (guideBuf) {
    const g = resize(decode(guideBuf), w, h);
    const planned = new Float32Array(w * h);
    let plannedPx = 0;
    let hitPx = 0;
    for (let p = 0; p < w * h; p++) {
      planned[p] = g[p * 4] + g[p * 4 + 1] + g[p * 4 + 2] > 24 ? 1 : 0;
      plannedPx += planned[p];
      if (planned[p] && diff[p] > 60) hitPx++; // unsmoothed: changes beside the spot mustn't count for it
    }
    onPlan = plannedPx ? hitPx / plannedPx : null;
    const near = blur(planned, w, h, Math.round(w * 0.015));
    const wide = blur(planned, w, h, Math.round(w * 0.07));
    // Thin lines (overhead wires Gemini redrew a few pixels off) would join everything into one
    // patch, so patches are found with them opened away, then the detail around them comes back.
    const r = Math.max(1, Math.round(w * 0.005));
    const solid = blur(blur(hard, w, h, r).map((v) => (v > 0.999 ? 1 : 0)), w, h, r).map((v) => (v > 0.001 ? 1 : 0));
    const patch = labelPatches(solid, w, h);
    const touches = new Set<number>();
    const size = new Map<number, number>();
    for (let p = 0; p < w * h; p++) {
      if (!patch[p]) continue;
      size.set(patch[p], (size.get(patch[p]) ?? 0) + 1);
      if (near[p] > 0.01) touches.add(patch[p]);
    }
    const keep = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) {
      if (!patch[p]) continue;
      // A patch that spreads over most of the picture means Gemini redrew everything (shifted or
      // re-lit it): there, only the old generous zone around the plan is kept.
      const huge = size.get(patch[p])! > w * h * 0.35;
      keep[p] = touches.has(patch[p]) && (!huge || wide[p] > 0.01) ? 1 : 0;
    }
    const around = blur(keep, w, h, 2 * r);
    for (let p = 0; p < w * h; p++) hard[p] = hard[p] && around[p] > 0.001 ? 1 : 0;
  }
  let changed = 0;
  for (let p = 0; p < w * h; p++) changed += hard[p];
  // Grow and soften the edge.
  const grown = blur(hard, w, h, Math.round(w * 0.012));
  const soft = blur(grown.map((v) => Math.min(1, v * 4)), w, h, Math.round(w * 0.008));

  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      // Fade towards the photo's own borders, so neighbouring directions blend.
      const edge = Math.min(1, Math.min(x, y, w - 1 - x, h - 1 - y) / (w * 0.06));
      const a = Math.round(255 * soft[p] * edge);
      // Blank the colour where nothing shows, so the PNG compresses well.
      png.data[p * 4] = a ? ed[p * 4] : 0;
      png.data[p * 4 + 1] = a ? ed[p * 4 + 1] : 0;
      png.data[p * 4 + 2] = a ? ed[p * 4 + 2] : 0;
      png.data[p * 4 + 3] = a;
    }
  }
  return { png: PNG.sync.write(png), changed: changed / (w * h), onPlan };
}
