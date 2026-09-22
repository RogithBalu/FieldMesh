import * as Device from 'expo-device';
import { Platform, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { AnimatedIcon } from '@/components/animated-icon';
import { HintRow } from '@/components/hint-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

function getDevMenuHint() {
  if (Platform.OS === 'web') {
    return <ThemedText type="small">use browser devtools</ThemedText>;
  }
  if (Device.isDevice) {
    return (
      <ThemedText type="small">
        shake device or press <ThemedText type="code">m</ThemedText> in terminal
      </ThemedText>
    );
  }
  const shortcut = Platform.OS === 'android' ? 'cmd+m (or ctrl+m)' : 'cmd+d';
  return (
    <ThemedText type="small">
      press <ThemedText type="code">{shortcut}</ThemedText>
    </ThemedText>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.heroSection}>
          <AnimatedIcon />
          <ThemedText type="title" style={styles.title}>
            Welcome to&nbsp;Expo
          </ThemedText>
        </ThemedView>

        <ThemedText type="code" style={styles.code}>
          get started
        </ThemedText>

        {/* FieldMesh Stitch Project Launcher */}
        <ThemedView type="backgroundElement" style={styles.fieldMeshLauncher}>
          <ThemedView style={styles.fieldMeshHeader}>
            <ThemedText type="subtitle" style={styles.fieldMeshTitle}>
              ⚡ FieldMesh Mobile
            </ThemedText>
            <ThemedText type="small" style={styles.fieldMeshTag}>
              STITCH IMPORT
            </ThemedText>
          </ThemedView>
          <ThemedText type="default" style={styles.fieldMeshDesc}>
            High-contrast industrial inspection system generated from Stitch MCP project #6300323291909235654.
          </ThemedText>
          <ThemedView style={styles.buttonRow}>
            <Pressable
              onPress={() => router.push('/inspections')}
              style={({ pressed }) => [styles.primaryLaunchBtn, pressed && { opacity: 0.75 }]}
            >
              <ThemedText style={styles.primaryLaunchText}>Open Inspections →</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => router.push('/login')}
              style={({ pressed }) => [styles.secondaryLaunchBtn, pressed && { opacity: 0.75 }]}
            >
              <ThemedText style={styles.secondaryLaunchText}>Login</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => router.push('/mesh')}
              style={({ pressed }) => [styles.secondaryLaunchBtn, pressed && { opacity: 0.75 }]}
            >
              <ThemedText style={styles.secondaryLaunchText}>Mesh</ThemedText>
            </Pressable>
          </ThemedView>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.stepContainer}>
          <HintRow
            title="Try editing"
            hint={<ThemedText type="code">src/app/(fieldmesh)/inspections/index.tsx</ThemedText>}
          />
          <HintRow title="Dev tools" hint={getDevMenuHint()} />
        </ThemedView>

        {Platform.OS === 'web' && <WebBadge />}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  heroSection: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  title: {
    textAlign: 'center',
  },
  code: {
    textTransform: 'uppercase',
  },
  stepContainer: {
    gap: Spacing.three,
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
  },
  fieldMeshLauncher: {
    alignSelf: 'stretch',
    padding: Spacing.four,
    borderRadius: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1.5,
    borderColor: '#3730a3',
  },
  fieldMeshHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  fieldMeshTitle: {
    fontWeight: '800',
    color: '#3730a3',
  },
  fieldMeshTag: {
    backgroundColor: '#3730a3',
    color: '#ffffff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    fontWeight: '700',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  fieldMeshDesc: {
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.85,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'transparent',
    marginTop: 4,
  },
  primaryLaunchBtn: {
    flex: 2,
    height: 44,
    backgroundColor: '#3730a3',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLaunchText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  secondaryLaunchBtn: {
    flex: 1,
    height: 44,
    backgroundColor: 'rgba(55, 48, 163, 0.12)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLaunchText: {
    color: '#3730a3',
    fontWeight: '700',
    fontSize: 13,
  },
});
