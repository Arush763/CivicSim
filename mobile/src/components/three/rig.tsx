import { useFrame, useThree } from './fiber';
import { useRef, type ReactNode } from 'react';
import * as THREE from 'three';

/** Camera position as an orbit around a target on the ground. */
export interface Orbit {
  target: THREE.Vector3;
  distance: number;
  polar: number; // 0 = straight down, π/2 = horizon
  azimuth: number;
}

/** Where the camera should go: center (scene coords) and how far back. */
export interface Focus {
  target: [number, number, number];
  distance: number;
}

/** Something drawn as a normal UI element pinned to a point in the 3D scene. */
export interface Anchor {
  id: string;
  pos: [number, number, number];
  /** 'center' centers the element on the point; 'above' sits it just above. */
  align?: 'center' | 'above';
  /** Drawn above the scene (true) or ignored by touches (false). */
  interactive?: boolean;
  node: ReactNode;
}

export type ScreenPositions = Record<string, { x: number; y: number; visible: boolean }>;

export interface ThreeViewProps {
  children?: ReactNode;
  /** 'map' = drag pans; 'orbit' = drag rotates around the focus. */
  mode?: 'map' | 'orbit';
  initial?: Partial<Omit<Orbit, 'target'>> & { target?: [number, number, number] };
  /** Fly the camera here whenever it changes. */
  focus?: Focus | null;
  limits?: { minDistance?: number; maxDistance?: number };
  /** Tap on the ground → scene x and z of the tapped point. */
  onGroundTap?: (x: number, z: number) => void;
  anchors?: Anchor[];
  /** Show +/− and reset buttons; placed at the given edge offsets. */
  controls?: { right?: number; bottom?: number; top?: number } | false;
  background?: string;
  style?: object;
}

export interface ThreeViewHandle {
  /** PNG of the current view as base64 (for request thumbnails). */
  snapshot: () => Promise<string | null>;
}

export const DEFAULT_ORBIT: Orbit = { target: new THREE.Vector3(), distance: 900, polar: 0.95, azimuth: -0.6 };

export function makeOrbit(initial?: ThreeViewProps['initial']): Orbit {
  return {
    target: new THREE.Vector3(...(initial?.target ?? [0, 0, 0])),
    distance: initial?.distance ?? DEFAULT_ORBIT.distance,
    polar: initial?.polar ?? DEFAULT_ORBIT.polar,
    azimuth: initial?.azimuth ?? DEFAULT_ORBIT.azimuth,
  };
}

/** Move the orbit target across the ground by a screen-space drag. */
export function panOrbit(o: Orbit, dxPx: number, dyPx: number, viewHeightPx: number, fovDeg = 50) {
  const metersPerPx = (2 * o.distance * Math.tan(((fovDeg / 2) * Math.PI) / 180)) / Math.max(1, viewHeightPx);
  const right = new THREE.Vector3(Math.cos(o.azimuth), 0, -Math.sin(o.azimuth));
  const forward = new THREE.Vector3(-Math.sin(o.azimuth), 0, -Math.cos(o.azimuth));
  o.target.addScaledVector(right, -dxPx * metersPerPx);
  o.target.addScaledVector(forward, (dyPx * metersPerPx) / Math.max(0.35, Math.cos(o.polar)));
}

const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Where a screen point (in px within the view) hits the ground plane. */
export function groundHit(camera: THREE.Camera, px: number, py: number, w: number, h: number): THREE.Vector3 | null {
  raycaster.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), camera);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(ground, hit) ? hit : null;
}

/**
 * Inside the canvas: drives the camera from the orbit (easing toward a focus goal) and reports
 * where each anchor lands on screen, only when the camera actually moved.
 */
export function Rig({
  orbit,
  goal,
  anchors,
  onProject,
  cameraRef,
  apply = true,
}: {
  orbit: React.RefObject<Orbit>;
  goal: React.RefObject<Focus | null>;
  anchors: Anchor[];
  onProject: (p: ScreenPositions) => void;
  cameraRef: React.RefObject<THREE.Camera | null>;
  /** false when something else (web OrbitControls) owns the camera. */
  apply?: boolean;
}) {
  const { camera, size } = useThree();
  const lastKey = useRef('');
  const v = useRef(new THREE.Vector3());
  cameraRef.current = camera;

  useFrame(() => {
    const o = orbit.current!;
    const g = goal.current;
    if (g) {
      const t = new THREE.Vector3(...g.target);
      o.target.lerp(t, 0.12);
      o.distance += (g.distance - o.distance) * 0.12;
      if (o.target.distanceTo(t) < 0.5 && Math.abs(g.distance - o.distance) < 1) goal.current = null;
    }
    if (apply) {
      camera.position.setFromSphericalCoords(o.distance, o.polar, o.azimuth).add(o.target);
      camera.lookAt(o.target);
    }
    camera.updateMatrixWorld();

    // Re-project anchors only when the view changed.
    const key = camera.matrixWorld.elements.map((n) => n.toFixed(2)).join(',') + size.width + 'x' + size.height + anchors.length;
    if (key === lastKey.current) return;
    lastKey.current = key;
    const out: ScreenPositions = {};
    for (const a of anchors) {
      v.current.set(...a.pos).project(camera);
      const x = ((v.current.x + 1) / 2) * size.width;
      const y = ((1 - v.current.y) / 2) * size.height;
      out[a.id] = { x, y, visible: v.current.z < 1 && x > -40 && x < size.width + 40 && y > -40 && y < size.height + 40 };
    }
    onProject(out);
  });
  return null;
}

export function Lights() {
  return (
    <>
      <hemisphereLight args={[0xdfeee6, 0x0a0c0b, 1.35]} />
      <directionalLight position={[-400, 700, 300]} intensity={1.9} />
      <directionalLight position={[500, 300, -400]} intensity={0.35} />
    </>
  );
}
