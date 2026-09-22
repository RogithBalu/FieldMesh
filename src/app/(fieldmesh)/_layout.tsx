import { Stack } from 'expo-router';

export default function FieldMeshLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#f9f9ff' },
      }}
    >
      <Stack.Screen name="inspections/index" />
      <Stack.Screen name="inspections/[id]" />
      <Stack.Screen name="inspections/dispute" options={{ presentation: 'card' }} />
      <Stack.Screen name="mesh/index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="onboarding" />
    </Stack>
  );
}
