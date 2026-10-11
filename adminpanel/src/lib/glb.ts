import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { serverUrl } from './config';

// GLTFLoader decodes the JSON chunk with TextDecoder; guard for engines that lack it.
if (typeof globalThis.TextDecoder === 'undefined') {
  class Utf8Decoder {
    decode(input?: ArrayBufferView | ArrayBuffer): string {
      if (!input) return '';
      const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      let out = '';
      for (let i = 0; i < bytes.length; ) {
        const b = bytes[i++];
        if (b < 0x80) out += String.fromCharCode(b);
        else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
        else if (b < 0xf0) out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
        else {
          const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
          out += String.fromCodePoint(cp);
        }
      }
      return out;
    }
  }
  (globalThis as unknown as { TextDecoder: unknown }).TextDecoder = Utf8Decoder;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();
const MAX_CACHED = 40;

/**
 * Fetch and parse a render. Files are content-addressed, so a URL's scene never changes and
 * parsed results can be cached and cloned freely.
 */
export function loadGlb(url: string): Promise<THREE.Object3D> {
  const abs = serverUrl(url);
  let p = cache.get(abs);
  if (!p) {
    p = fetch(abs, { headers: { 'ngrok-skip-browser-warning': '1' } })
      .then((r) => {
        if (!r.ok) throw new Error(`GET ${abs} → ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => new Promise<THREE.Object3D>((resolve, reject) => loader.parse(buf, '', (g) => resolve(g.scene), reject)));
    p.catch(() => cache.delete(abs));
    cache.set(abs, p);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  }
  return p.then((obj) => obj.clone());
}

/** LOD level encoded in a render URL (…/lod0.glb = highest detail). */
export const lodLevel = (url: string) => Number(/lod(\d)\.glb/.exec(url)?.[1] ?? 0);
