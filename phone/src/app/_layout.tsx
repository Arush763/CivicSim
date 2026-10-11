import { GoogleSans_400Regular } from '@expo-google-fonts/google-sans/400Regular';
import { GoogleSans_500Medium } from '@expo-google-fonts/google-sans/500Medium';
import { GoogleSans_700Bold } from '@expo-google-fonts/google-sans/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SignInGate } from '@/components/SignIn';
import { AuthProvider } from '@/lib/auth';
import { NearMeProvider } from '@/lib/location';
import { SettingsProvider, useTheme } from '@/lib/settings';

function Shell() {
  const c = useTheme();
  const [loaded, error] = useFonts({ GoogleSans_400Regular, GoogleSans_500Medium, GoogleSans_700Bold });
  // Hold the first paint until fonts are in (system fonts if they fail).
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return (
    <>
      <StatusBar style={c.dark ? 'light' : 'dark'} />
      <SignInGate>
        {/* The design swaps pages and lets each one play its entrance, so screens cross-fade quickly. */}
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'fade', animationDuration: 200 }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="zone/[id]" />
          <Stack.Screen name="new/[areaId]" options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom' }} />
          <Stack.Screen name="request/[id]" />
          <Stack.Screen name="petition/[proposalId]" options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom' }} />
        </Stack>
      </SignInGate>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <AuthProvider>
          <NearMeProvider>
            <Shell />
          </NearMeProvider>
        </AuthProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
