import { File } from 'expo-file-system';
import { GLView } from 'expo-gl';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { PanResponder, View, type GestureResponderEvent } from 'react-native';
import * as THREE from 'three';
import { Icon } from '../icons';
import { IconButton } from '../ui';
import { AnchorLayer } from './AnchorLayer';
import { Canvas } from './fiber';
import { Lights, Rig, groundHit, makeOrbit, panOrbit, type Focus, type Orbit, type ScreenPositions, type ThreeViewHandle, type ThreeViewProps } from './rig';

/** Phone version of the 3D view (browser version: ThreeView.web.tsx). */
export const ThreeView = forwardRef<ThreeViewHandle, ThreeViewProps>(function ThreeView(
  { children, mode = 'map', initial, focus, limits, onGroundTap, anchors = [], controls = { right: 16, bottom: 16 }, background = '#070908', style },
  ref,
) {
  const orbit = useRef<Orbit>(makeOrbit(initial));
  const goal = useRef<Focus | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const size = useRef({ w: 1, h: 1 });
  const [positions, setPositions] = useState<ScreenPositions>({});
  const minD = limits?.minDistance ?? 80;
  const maxD = limits?.maxDistance ?? 3200;
  const clampD = (d: number) => THREE.MathUtils.clamp(d, minD, maxD);
  const home = useRef<Focus>({ target: initial?.target ?? [0, 0, 0], distance: initial?.distance ?? 900 });

  useEffect(() => {
    if (focus) {
      goal.current = { target: focus.target, distance: clampD(focus.distance) };
      home.current = focus;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.target.join(','), focus?.distance]);

  useImperativeHandle(ref, () => ({
    snapshot: async () => {
      if (!glRef.current) return null;
      try {
        const snap = await GLView.takeSnapshotAsync(glRef.current as never, { format: 'png', compress: 0.6 });
        return typeof snap.uri === 'string' ? await new File(snap.uri).base64() : null;
      } catch {
        return null;
      }
    },
  }));

  // map: one finger pans, two fingers pinch-zoom and twist-rotate. orbit: one finger rotates.
  const pan = useMemo(() => {
    type Touchy = { x: number; y: number; pinch: number | null; mid: number | null };
    let last: Touchy | null = null;
    let start: { x: number; y: number; t: number; moved: number } | null = null;
    const read = (e: GestureResponderEvent): Touchy => {
      const ts = e.nativeEvent.touches;
      if (ts.length >= 2) {
        return {
          x: (ts[0].pageX + ts[1].pageX) / 2,
          y: (ts[0].pageY + ts[1].pageY) / 2,
          pinch: Math.hypot(ts[0].pageX - ts[1].pageX, ts[0].pageY - ts[1].pageY),
          mid: (ts[0].pageX + ts[1].pageX) / 2,
        };
      }
      return { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, pinch: null, mid: null };
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        last = read(e);
        start = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY, t: Date.now(), moved: 0 };
      },
      onPanResponderMove: (e) => {
        if (!last || !start) return;
        const now = read(e);
        const o = orbit.current;
        const dx = now.x - last.x;
        const dy = now.y - last.y;
        start.moved += Math.hypot(dx, dy);
        if (start.moved > 4) goal.current = null; // a person took over the camera
        if (now.pinch && last.pinch) {
          o.distance = clampD(o.distance * (last.pinch / now.pinch));
          if (mode === 'map') o.azimuth -= dx * 0.006; // two-finger sideways drag rotates
          else panOrbit(o, dx, dy, size.current.h);
        } else if (!now.pinch && !last.pinch) {
          if (mode === 'map') panOrbit(o, dx, dy, size.current.h);
          else {
            o.azimuth -= dx * 0.008;
            o.polar = THREE.MathUtils.clamp(o.polar - dy * 0.006, 0.15, 1.35);
          }
        }
        last = now;
      },
      onPanResponderRelease: () => {
        if (start && onGroundTap && start.moved < 8 && Date.now() - start.t < 400 && cameraRef.current) {
          const hit = groundHit(cameraRef.current, start.x, start.y, size.current.w, size.current.h);
          if (hit) onGroundTap(hit.x, hit.z);
        }
        last = null;
        start = null;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, onGroundTap]);

  const zoom = (f: number) => {
    goal.current = { target: orbit.current.target.toArray() as [number, number, number], distance: clampD(orbit.current.distance * f) };
  };

  return (
    <View
      style={[{ overflow: 'hidden', backgroundColor: background }, style]}
      onLayout={(e) => (size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      {...pan.panHandlers}
    >
      <Canvas
        gl={{ preserveDrawingBuffer: true }}
        camera={{ fov: 50, near: 1, far: 20000 }}
        onCreated={(state) => {
          glRef.current = state.gl.getContext() as WebGLRenderingContext;
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
