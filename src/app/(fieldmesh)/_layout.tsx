import { Redirect, Stack, useSegments } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { FieldMeshColors } from '@/constants/fieldMeshTheme';

const PUBLIC_SCREENS = new Set(['login']);

export default function FieldMeshLayout() {
  const { loading, user } = useAuth();
  const segments = useSegments();
  const current = segments[segments.length - 1] ?? '';

  // Auth guard: every screen in this group except login needs a session.
  if (!loading && !user && !PUBLIC_SCREENS.has(current)) {
    return <Redirect href="/(fieldmesh)/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: FieldMeshColors.surface },
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="teams" />
      <Stack.Screen name="inspections/index" />
      <Stack.Screen name="inspections/new" />
      <Stack.Screen name="inspections/[id]" />
      <Stack.Screen name="inspections/dispute" options={{ presentation: 'card' }} />
      <Stack.Screen name="inspections/history" />
      <Stack.Screen name="inspections/report" />
      <Stack.Screen name="mesh/index" />
    </Stack>
  );
}
