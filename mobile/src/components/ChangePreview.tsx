import type { ChangeOp, SceneIndex } from '@mamdani/shared';
import { forwardRef, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GOOGLE_MAPS_KEY } from '@/lib/config';
import { changeFocus, describeOp } from '@/lib/ops';
import type { StreetViewStatus } from '@/lib/streetview';
import { useTheme } from '@/lib/theme';
import { StreetView } from './streetview/StreetView';
import type { ThreeViewHandle } from './three/rig';
import { ChangeView } from './three/ChangeView';
import { Chip, Muted } from './ui';

/**
 * A request, seen two ways: in Google Street View with the change drawn into the real street
 * (before / compare / after, walkable), or as the 3D model on its own. Falls back to the model
 * where Google has no Street View photos.
 */
export const ChangePreview = forwardRef<ThreeViewHandle, { lods: string[]; ops: ChangeOp[]; scene?: SceneIndex | null; /** Omit to fill the parent. */ height?: number }>(
  function ChangePreview({ lods, ops, scene, height }, ref) {
    const t = useTheme();
    const focus = useMemo(() => changeFocus(ops, scene), [ops, scene]);
    // Until the person picks, show Street View as soon as there's a key and a place to look at.
    const [picked, setTab] = useState<'street' | 'model' | null>(null);
    const tab = picked ?? (GOOGLE_MAPS_KEY && focus ? 'street' : 'model');
    const [note, setNote] = useState<string | null>(GOOGLE_MAPS_KEY ? null : 'Add a Google Maps key to see this in Street View.');
    const onStatus = useCallback((s: StreetViewStatus, message?: string) => {
      if (s === 'nopano' || s === 'error') {
        setNote(s === 'nopano' ? 'No Street View photos here, so this is the 3D model.' : message ?? 'Street View could not be shown.');
        setTab('model');
      }
    }, []);

    return (
      <View style={[{ gap: 8 }, height ? null : { flex: 1 }]}>
        <View style={styles.tabs}>
          <Chip label="Street View" active={tab === 'street'} onPress={focus ? () => setTab('street') : undefined} style={styles.tab} />
          <Chip label="3D model" active={tab === 'model'} onPress={() => setTab('model')} style={styles.tab} />
          {note && <Muted style={{ flexShrink: 1, fontSize: 12 }}>{note}</Muted>}
        </View>
        <View style={height ? { height } : { flex: 1 }}>
          {tab === 'street' && focus ? (
            <StreetView glb={lods[0]} focus={focus} ops={ops} desc={ops.map((o) => describeOp(o, scene)).join('; ')} onStatus={onStatus} style={[StyleSheet.absoluteFill, styles.frame, { borderColor: t.border }]} />
          ) : (
            <ChangeView ref={ref} urls={lods} caption="Only the change is in colour · drag to orbit" />
          )}
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tab: { minHeight: 36, paddingHorizontal: 14 },
  frame: { borderRadius: 20, borderWidth: 1 },
});
