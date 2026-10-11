import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { zoneIdAt } from '@mamdani/shared';
import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { decode, GRID, zoneTerrain } from './terrain';

/** A Terrarium tile whose height rises 1 m per pixel row going south (so the ground slopes up to the north). */
function slopeTile(base: number): Buffer {
  const png = new PNG({ width: 256, height: 256 });
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const h = base - y + 32768;
      const i = (y * 256 + x) * 4;
      png.data[i] = Math.floor(h / 256);
      png.data[i + 1] = Math.floor(h) % 256;
      png.data[i + 2] = Math.round((h % 1) * 256);
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe('terrain', () => {
  it('decodes Terrarium pixels', () => {
    expect(decode(128, 0, 0)).toBe(0);
    expect(decode(128, 100, 128)).toBeCloseTo(100.5, 5);
  });

  it('builds a height grid around a zone, relative to its centre, that follows the slope', async () => {
    const prev = config.cacheDir;
    config.cacheDir = mkdtempSync(path.join(tmpdir(), 'terrain-'));
    try {
      let calls = 0;
      const fake = (async (url: string) => {
        calls++;
        const y = Number(/\/(\d+)\.png$/.exec(String(url))![1]);
        return new Response(new Uint8Array(slopeTile(1000 - (y % 4) * 256)));
      }) as typeof fetch;
      const t = await zoneTerrain(zoneIdAt(-73.65, 41.78), fake);
      expect(t.heights).toHaveLength(GRID * GRID);
      const mid = Math.floor(GRID / 2);
      expect(Math.abs(t.heights[mid * GRID + mid])).toBeLessThan(0.5); // ~0 at the centre
      // North (last row) is higher than south (first row).
      expect(t.heights[(GRID - 1) * GRID + mid]).toBeGreaterThan(t.heights[mid] + 50);
      expect(calls).toBeLessThanOrEqual(4);
    } finally {
      config.cacheDir = prev;
    }
  });
});
