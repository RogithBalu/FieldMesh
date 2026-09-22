import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';

/**
 * Local hotspot / peer-to-peer mesh sync is real, substantial architecture
 * (native Android hotspot module, TCP hub, chain relay) built in the separate
 * mobile app repo — it needs custom native modules, which means leaving Expo
 * Go for a custom dev client. Out of scope for this pass; this screen says so
 * honestly instead of faking a peer list.
 */
export default function MeshNetworkScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <FieldMeshHeader title="Local Mesh" category="OFFLINE SYNC" showBack onBackPress={() => router.back()} />
      <View style={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <FieldMeshIcon name="hub" size={40} color={FieldMeshColors.outline} />
        <Text style={styles.title}>Not built in this app yet</Text>
        <Text style={styles.body1}>
          Phone-to-phone sync over a local Wi-Fi hotspot needs custom native modules
          (hotspot control, a TCP relay), which means leaving Expo Go for a custom
          dev client. This screen is a placeholder rather than a fake demo.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FieldMeshColors.surface },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  title: { fontSize: 16, fontWeight: '700', color: FieldMeshColors.onSurface },
  body1: { fontSize: 13, color: FieldMeshColors.onSurfaceVariant, textAlign: 'center', lineHeight: 19 },
});
