import { forwardRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '@/lib/theme';
import type { Focus, ThreeViewHandle } from './rig';
import { ThreeView } from './ThreeView';
import { focusOn, TileLod } from '../TileLod';

/**
 * 3D view of one request: grey context with only the change in green. The camera frames the
 * change; drag to orbit, pinch or scroll to zoom.
 */
export const ChangeView = forwardRef<ThreeViewHandle, { urls: string[]; /** Omit to fill the parent. */ height?: number; caption?: string }>(function ChangeView(
  { urls, height, caption = 'Only the change is in colour' },
  ref,
) {
  const t = useTheme();
  const [focus, setFocus] = useState<Focus | null>(null);
  const [loading, setLoading] = useState(true);
  return (
    <View style={[styles.wrap, height ? { height } : { flex: 1 }, { borderColor: t.border, backgroundColor: SKY }]}>
      <ThreeView
        ref={ref}
        mode="orbit"
        initial={{ distance: 600, polar: 0.72, azimuth: -0.7 }}
        focus={focus}
        limits={{ minDistance: 60, maxDistance: 1400 }}
        controls={{ right: 12, bottom: 12 }}
        background={SKY}
        style={StyleSheet.absoluteFill}
      >
        <TileLod
          urls={urls}
          onFirstLoad={(obj) => {
            setLoading(false);
            const f = focusOn(obj);
            if (f) setFocus({ target: [f.target.x, 0, f.target.z], distance: f.distance });
          }}
        />
      </ThreeView>
      <View pointerEvents="none" style={[styles.caption, { backgroundColor: '#FFFFFFE6', borderColor: t.border }]}>
        <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 11 }}>{caption}</Text>
      </View>
      {loading && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={t.accent} />
        </View>
      )}
    </View>
  );
});

/** Light sky behind the 3D view, matching the map's light look. */
const SKY = '#E8EAED';

const styles = StyleSheet.create({
  wrap: { width: '100%', borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  caption: { position: 'absolute', left: 12, bottom: 12, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
