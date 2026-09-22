import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { FieldMeshColors } from '@/constants/fieldMeshTheme';
import { useAuth } from '@/lib/auth-context';

/** Launch gate: waits for the stored session to be validated, then routes. */
export default function LaunchGate() {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={FieldMeshColors.primary} />
        <Text style={styles.hint}>Restoring session…</Text>
      </View>
    );
  }

  return <Redirect href={user ? '/(fieldmesh)/inspections' : '/(fieldmesh)/login'} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: FieldMeshColors.surface,
  },
  hint: { fontFamily: 'monospace', fontSize: 11, color: FieldMeshColors.onSurfaceVariant },
});
