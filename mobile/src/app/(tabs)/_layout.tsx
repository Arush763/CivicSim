import { Tabs } from 'expo-router';
import { AppNav } from '@/components/AppNav';
import { useIsWide, useTheme } from '@/lib/theme';

export default function TabsLayout() {
  const t = useTheme();
  const wide = useIsWide();
  return (
    <Tabs
      tabBar={(props) => <AppNav {...props} />}
      screenOptions={{
        // Screens draw their own headers, as in the design.
        headerShown: false,
        tabBarPosition: wide ? 'top' : 'bottom',
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Map' }} />
      <Tabs.Screen name="proposals" options={{ title: 'Requests' }} />
      <Tabs.Screen name="petitions" options={{ title: 'Petitions' }} />
      <Tabs.Screen name="leaderboard" options={{ title: 'Ranks' }} />
      <Tabs.Screen name="account" options={{ title: 'You' }} />
    </Tabs>
  );
}
