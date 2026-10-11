import { Roboto_400Regular, Roboto_500Medium, Roboto_700Bold } from '@expo-google-fonts/roboto';
import { RobotoMono_400Regular, RobotoMono_500Medium } from '@expo-google-fonts/roboto-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { AdminGate } from '@/components/AdminGate';
import { MapsProvider } from '@/components/map/MapsProvider';
import { AuthProvider } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

export default function RootLayout() {
  const t = useTheme();
  const [loaded, error] = useFonts({ Roboto_400Regular, Roboto_500Medium, Roboto_700Bold, RobotoMono_400Regular, RobotoMono_500Medium });
  // Hold the first paint until fonts are in (fall back to system fonts on error).
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  return (
    <AuthProvider>
      <AdminGate>
      <MapsProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="area/[id]" />
        <Stack.Screen name="draft/[id]" />
        <Stack.Screen name="proposal/[id]" />
      </Stack>
      </MapsProvider>
      </AdminGate>
    </AuthProvider>
  );
}
