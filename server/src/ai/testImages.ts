/** Tiny real images for tests (a grey street photo, and an edit with a "new thing" in it). */
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export function greyJpeg(size = 64): Buffer {
  const data = Buffer.alloc(size * size * 4, 128);
  return Buffer.from(jpeg.encode({ width: size, height: size, data }, 95).data);
}

/** The same grey picture with a green square (the "change") in the middle. */
export function editedPng(size = 64): Buffer {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside = x > size * 0.4 && x < size * 0.6 && y > size * 0.4 && y < size * 0.6;
      png.data[i] = inside ? 40 : 128;
      png.data[i + 1] = inside ? 160 : 128;
      png.data[i + 2] = inside ? 60 : 128;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
