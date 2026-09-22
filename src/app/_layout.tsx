// Must be the first import: Yjs (client ids) and EditLog (edit ids) need
// crypto.getRandomValues before any of them are loaded.
import 'react-native-get-random-values';
import '@/lib/cryptoShim';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { LogBox, useColorScheme } from 'react-native';
import { AuthProvider } from '@/lib/auth-context';

// isomorphic-webcrypto (pulled in by Yjs on React Native) logs about falling back
// to non-secure randomness for its own operations; Yjs only uses it for client ids.
LogBox.ignoreLogs(['asmCrypto seems to be load', 'isomorphic-webcrypto cannot ensure']);

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(fieldmesh)" />
        </Stack>
      </ThemeProvider>
    </AuthProvider>
  );
}
