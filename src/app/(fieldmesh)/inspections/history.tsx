import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { PhotoThumb } from '@/components/fieldmesh/PhotoThumb';
import { useAuth } from '@/lib/auth-context';
import { api, errorMessage, type EditRow } from '@/lib/api';
import { displayValue, fieldTitle, formatTime } from '@/lib/checklist';
import { decodeHlc } from '@/lib/editlog/hlc';
import { isPhotoHash } from '@/lib/photos';
import { nameFor } from '@/lib/names';

/** Audit trail: GET /inspections/:id/history — every edit the server has, ordered by HLC. */
export default function HistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [rows, setRows] = useState<EditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setRows(await api.history(id));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
      setRows((r) => r ?? []);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const list = [...(rows ?? [])].reverse();

  return (
    <View style={styles.container}>
      <FieldMeshHeader title="Audit Trail" category="EDIT HISTORY" showBack statusBadge={{ label: `${rows?.length ?? 0} edits`, variant: 'offline' }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && (
          <View style={styles.errorBanner}>
            <FieldMeshIcon name="cloud_off" size={16} color={FieldMeshColors.onErrorContainer} />
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}
        {rows === null ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={FieldMeshColors.primary} />
        ) : list.length === 0 ? (
          <View style={styles.emptyState}>
            <FieldMeshIcon name="history" size={32} color={FieldMeshColors.outline} />
            <Text style={styles.emptyTitle}>No edits recorded on the server yet</Text>
            <Text style={styles.emptyBody}>Edits appear here once the checklist syncs.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {list.map((r) => {
              const wall = decodeHlc(r.hlc).wall;
              let parents: string[] = [];
              try {
                parents = JSON.parse(r.parents || '[]');
              } catch {
                parents = [];
              }
              const isResolution = parents.length > 1;
              return (
                <View key={r.edit_id} style={[styles.row, r.disputed === 1 && styles.rowDisputed, isResolution && styles.rowResolution]}>
                  <View style={styles.rowIcon}>
                    <FieldMeshIcon
                      name={r.disputed === 1 ? 'warning' : isResolution ? 'verified_user' : 'edit'}
                      size={18}
                      color={r.disputed === 1 ? FieldMeshColors.tertiary : isResolution ? FieldMeshColors.secondary : FieldMeshColors.primary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={styles.fieldName}>{fieldTitle(r.field_id)}</Text>
                      <Text style={styles.time}>{formatTime(wall)}</Text>
                    </View>
                    {isPhotoHash(r.value) ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                        <PhotoThumb hash={r.value} size={40} />
                        <Text style={styles.value}>photo {r.value.slice(0, 10)}…</Text>
                      </View>
                    ) : (
                      <Text style={styles.value}>{displayValue(r.value)}</Text>
                    )}
                    <Text style={styles.meta}>
                      {nameFor(r.author, user && r.author === user.id ? user.name : undefined)} · {r.device}
                      {isResolution ? ` · resolved ${parents.length} entries` : parents.length === 1 ? ' · supersedes 1' : ' · first entry'}
                      {r.disputed === 1 ? ' · DISPUTED' : ''}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FieldMeshColors.surface },
  scroll: { flex: 1 },
  content: { padding: FieldMeshSpacing.gutter, gap: FieldMeshSpacing.md },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: FieldMeshColors.errorContainer, padding: 10, borderRadius: FieldMeshRadius.md },
  errorBannerText: { flex: 1, fontSize: 12, fontWeight: '600', color: FieldMeshColors.onErrorContainer },
  emptyState: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: FieldMeshColors.onSurface, textAlign: 'center' },
  emptyBody: { fontSize: 12, color: FieldMeshColors.onSurfaceVariant, textAlign: 'center' },
  list: { gap: 8 },
  row: { flexDirection: 'row', gap: 10, backgroundColor: FieldMeshColors.surfaceLowest, borderRadius: FieldMeshRadius.md, padding: 12, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh },
  rowDisputed: { borderColor: FieldMeshColors.tertiaryFixedDim, backgroundColor: FieldMeshColors.tertiaryFixed },
  rowResolution: { borderColor: FieldMeshColors.secondaryFixedDim },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: FieldMeshColors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  fieldName: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.onSurface, flex: 1 },
  time: { fontFamily: 'monospace', fontSize: 10.5, color: FieldMeshColors.onSurfaceVariant },
  value: { fontSize: 13, color: FieldMeshColors.onSurface, marginTop: 2 },
  meta: { fontFamily: 'monospace', fontSize: 10.5, color: FieldMeshColors.outline, marginTop: 4 },
});
