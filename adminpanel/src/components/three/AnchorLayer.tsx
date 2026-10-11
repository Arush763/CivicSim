import { StyleSheet, View } from 'react-native';
import type { Anchor, ScreenPositions } from './rig';

const BOX_W = 220;
const BOX_H = 48;

/** Draws each anchor's UI element at its projected screen position, above the 3D canvas. */
export function AnchorLayer({ anchors, positions }: { anchors: Anchor[]; positions: ScreenPositions }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {anchors.map((a) => {
        const p = positions[a.id];
        if (!p?.visible) return null;
        return (
          <View
            key={a.id}
            pointerEvents={a.interactive ? 'box-none' : 'none'}
            style={{
              position: 'absolute',
              left: p.x - BOX_W / 2,
              top: a.align === 'above' ? p.y - BOX_H : p.y - BOX_H / 2,
              width: BOX_W,
              height: BOX_H,
              alignItems: 'center',
              justifyContent: a.align === 'above' ? 'flex-end' : 'center',
            }}
          >
            {a.node}
          </View>
        );
      })}
    </View>
  );
}
