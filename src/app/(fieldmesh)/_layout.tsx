import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useAuth } from '@/lib/auth-context';

const PUBLIC_SCREENS = new Set(['login']);

export default function FieldMeshLayout() {
  const { loading, user } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const current = segments[segments.length - 1] ?? '';
    const isPublic = PUBLIC_SCREENS.has(current);
    if (!user && !isPublic) {
      router.replace('/(fieldmesh)/login');
    }
  }, [loading, user, segments]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#f9f9ff' },
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="teams" />
      <Stack.Screen name="inspections/index" />
      <Stack.Screen name="inspections/new" />
      <Stack.Screen name="inspections/[id]" />
      <Stack.Screen name="inspections/dispute" options={{ presentation: 'card' }} />
      <Stack.Screen name="inspections/report" />
      <Stack.Screen name="mesh/index" />
    </Stack>
  );
}
