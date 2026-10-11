import { TabList, TabSlot, Tabs, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { forwardRef, useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { T } from '@/components/ui';
import { useTheme } from '@/lib/settings';

const TABS: { name: string; href: '/' | '/feed' | '/ranks' | '/settings'; label: string; icon: IconName }[] = [
  { name: 'index', href: '/', label: 'Map', icon: 'map' },
  { name: 'feed', href: '/feed', label: 'Feed', icon: 'feed' },
  { name: 'ranks', href: '/ranks', label: 'Ranks', icon: 'ranks' },
  { name: 'settings', href: '/settings', label: 'Settings', icon: 'settings' },
];

/** One tab of the design's bottom bar: an icon in a pill that grows in when the tab is active. */
const TabButton = forwardRef<View, TabTriggerSlotProps & { label: string; icon: IconName }>(function TabButton({ isFocused, label, icon, ...props }, ref) {
  const c = useTheme();
  const s = useSharedValue(isFocused ? 1 : 0);
  useEffect(() => {
    s.value = withSpring(isFocused ? 1 : 0, { damping: 14, stiffness: 220 });
  }, [isFocused, s]);
  const pill = useAnimatedStyle(() => ({ opacity: s.value, transform: [{ scaleX: 0.3 + 0.7 * s.value }] }));
  const fg = isFocused ? c.accentFg : c.text2;
  return (
    <Pressable ref={ref} {...props} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: !!isFocused }}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, height: 56 }}>
      <View style={{ width: 56, height: 28, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ position: 'absolute', inset: 0, borderRadius: 14, backgroundColor: c.accentBg }, pill]} />
        <Icon name={icon} size={22} color={fg} />
      </View>
      <T size={12} weight={isFocused ? 'bold' : 'medium'} color={fg}>{label}</T>
    </Pressable>
  );
});

export default function TabsLayout() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs>
      <TabSlot />
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', paddingTop: 4, paddingHorizontal: 8, paddingBottom: Math.max(8, insets.bottom), backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border }}>
        {TABS.map((t) => (
          <TabTrigger key={t.name} name={t.name} asChild>
            <TabButton label={t.label} icon={t.icon} />
          </TabTrigger>
        ))}
      </View>
      <TabList style={{ display: 'none' }}>
        {TABS.map((t) => (
          <TabTrigger key={t.name} name={t.name} href={t.href} />
        ))}
      </TabList>
    </Tabs>
  );
}
