import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View } from 'react-native';
import * as THREE from 'three';
import { Icon } from '../icons';
import { IconButton } from '../ui';
import { AnchorLayer } from './AnchorLayer';
import { Canvas } from './fiber';
import { Lights, Rig, groundHit, makeOrbit, panOrbit, type Focus, type Orbit, type ScreenPositions, type ThreeViewHandle, type ThreeViewProps } from './rig';

/**
 * Browser version of the 3D view. Map mode: left-drag pans, right-drag (or shift-drag) rotates,
 * scroll zooms. Orbit mode: drag rotates. Click the ground to pick.
 */
export const ThreeView = forwardRef<ThreeViewHandle, ThreeViewProps>(function ThreeView(
  { children, mode = 'map', initial, focus, limits, onGroundTap, anchors = [], controls = { right: 16, bottom: 16 }, background = '#070908', style },
  ref,
) {
  const orbit = useRef<Orbit>(makeOrbit(initial));
  const goal = useRef<Focus | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [positions, setPositions] = useState<ScreenPositions>({});
  const minD = limits?.minDistance ?? 80;
  const maxD = limits?.maxDistance ?? 3200;
  const clampD = (d: number) => THREE.MathUtils.clamp(d, minD, maxD);
  const home = useRef<Focus>({ target: initial?.target ?? [0, 0, 0], distance: initial?.distance ?? 900 });
  const tapRef = useRef(onGroundTap);
  tapRef.current = onGroundTap;

  useEffect(() => {
    if (focus) {
      goal.current = { target: focus.target, distance: clampD(focus.distance) };
      home.current = focus;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.target.join(','), focus?.distance]);

  useImperativeHandle(ref, () => ({
    snapshot: async () => canvasRef.current?.toDataURL('image/png').split(',')[1] ?? null,
  }));

  // Pointer + wheel input on the canvas element.
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const el = canvasEl;
    if (!el) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number; t: number; moved: number; rotate: boolean } | null = null;
    let pinch: number | null = null;

    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        drag = { x: e.clientX, y: e.clientY, t: Date.now(), moved: 0, rotate: mode === 'orbit' || e.button === 2 || e.shiftKey };
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const o = orbit.current;
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        o.distance = clampD(o.distance * (pinch / d));
        pinch = d;
        goal.current = null;
        return;
      }
      if (!drag) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      drag.moved += Math.hypot(dx, dy);
      if (drag.moved > 4) goal.current = null;
      if (drag.rotate) {
        o.azimuth -= dx * 0.006;
        o.polar = THREE.MathUtils.clamp(o.polar - dy * 0.005, 0.15, 1.35);
      } else {
        panOrbit(o, dx, dy, el.clientHeight);
      }
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (drag && pointers.size === 0) {
        if (tapRef.current && drag.moved < 6 && Date.now() - drag.t < 400 && cameraRef.current) {
          const r = el.getBoundingClientRect();
          const hit = groundHit(cameraRef.current, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
          if (hit) tapRef.current(hit.x, hit.z);
        }
        drag = null;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      goal.current = null;
      orbit.current.distance = clampD(orbit.current.distance * Math.exp(e.deltaY * 0.0012));
    };
    const noMenu = (e: Event) => e.preventDefault();
    el.style.touchAction = 'none';
    el.style.cursor = onGroundTap ? 'pointer' : 'grab';
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', noMenu);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', noMenu);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasEl, mode, !!onGroundTap]);

  const zoom = (f: number) => {
    goal.current = { target: orbit.current.target.toArray() as [number, number, number], distance: clampD(orbit.current.distance * f) };
  };

  return (
    <View style={[{ overflow: 'hidden', backgroundColor: background }, style]}>
      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ fov: 50, near: 1, far: 20000 }}
        onCreated={(state) => {
          canvasRef.current = state.gl.domElement;
          setCanvasEl(state.gl.domElement);
          state.scene.background = new THREE.Color(background);
        }}
      >
        <Lights />
        <Rig orbit={orbit} goal={goal} anchors={anchors} onProject={setPositions} cameraRef={cameraRef} />
        {children}
      </Canvas>
      <AnchorLayer anchors={anchors} positions={positions} />
      {controls && (
        <View style={{ position: 'absolute', right: controls.right, bottom: controls.bottom, top: controls.top, gap: 8 }} pointerEvents="box-none">
          <IconButton label="Zoom in" onPress={() => zoom(0.7)}><Icon name="plus" size={20} /></IconButton>
          <IconButton label="Zoom out" onPress={() => zoom(1.4)}><Icon name="minus" size={20} /></IconButton>
          <IconButton label="Reset view" onPress={() => (goal.current = home.current)}><Icon name="reset" size={20} /></IconButton>
        </View>
      )}
    </View>
  );
});
