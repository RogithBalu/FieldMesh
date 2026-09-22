import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { FieldMeshColors } from '@/constants/fieldMeshTheme';

/** Launch gate: routes to login or straight into the app based on session state. */
export default function LaunchGate() {
  const router = useRouter();
  const { loading, user } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/(fieldmesh)/inspections' : '/(fieldmesh)/login');
  }, [loading, user]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={FieldMeshColors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FieldMeshColors.surface,
  },
});
