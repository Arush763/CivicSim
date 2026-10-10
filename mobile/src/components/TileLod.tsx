import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { loadGlb, lodLevel } from '@/lib/glb';

/** Distance (m) from the camera at which each LOD takes over: lod0 close, lod2 far. */
const LOD_DISTANCES = [0, 650, 1300];

// Meshes that only exist because of a requested change (the grey base is 'context_road', 'footprint', 'park', 'ground').
const CHANGE_MESHES = new Set(['bike', 'bus', 'buffer', 'road', 'sidewalk', 'marking', 'park_new', 'canopy', 'trunk', 'building_new', 'highlight']);

/** Where the camera should look to frame a request's changes: their center and a viewing distance. */
export function focusOn(obj: THREE.Object3D): { target: THREE.Vector3; distance: number } | null {
  const box = new THREE.Box3();
  let found = false;
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && CHANGE_MESHES.has(o.name)) {
      box.expandByObject(o);
      found = true;
    }
  });
  if (!found) return null;
  const target = box.getCenter(new THREE.Vector3()).setY(0);
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z) / 2;
  return { target, distance: THREE.MathUtils.clamp(radius * 3, 300, 1000) };
}

/**
 * The scene as a THREE.LOD. Levels stream in low → high detail; whichever is the best loaded
 * level so far covers distance 0, so the view sharpens progressively instead of popping in.
 */
export function TileLod({ urls, onFirstLoad }: { urls: string[]; onFirstLoad?: (obj: THREE.Object3D) => void }) {
  const [levels, setLevels] = useState<Map<number, THREE.Object3D>>(new Map());
  const key = urls.join('|');

  useEffect(() => {
    let cancelled = false;
    setLevels(new Map());
    const ordered = [...urls].sort((a, b) => lodLevel(b) - lodLevel(a)); // lowest detail first
    let first = true;
    (async () => {
      for (const url of ordered) {
        try {
          const obj = await loadGlb(url);
          if (cancelled) return;
          setLevels((prev) => new Map(prev).set(lodLevel(url), obj));
          if (first) {
            first = false;
            onFirstLoad?.(obj);
          }
        } catch (err) {
          console.warn('render load failed', url, err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const lod = useMemo(() => {
    const l = new THREE.LOD();
    const available = [...levels.keys()].sort();
    available.forEach((level, i) => l.addLevel(levels.get(level)!, i === 0 ? 0 : LOD_DISTANCES[level]));
    return l;
  }, [levels]);

  return <primitive object={lod} />;
}
