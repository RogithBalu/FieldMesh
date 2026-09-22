import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { CHECKLIST_TEMPLATE } from '@/constants/checklistTemplate';
import { useAuth } from '@/lib/auth-context';
import { useInspectionDoc } from '@/lib/useInspectionDoc';
import * as db from '@/lib/localdb';

export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, deviceId } = useAuth();
  const docHook = useInspectionDoc(id, deviceId, user?.name ?? null);
  const [inspection, setInspection] = useState<db.Inspection | null>(null);

  useEffect(() => {
    if (id) db.getInspection(id).then((i) => setInspection(i ?? null));
  }, [id]);

  if (!inspection || !docHook.ready) {
    return (
      <View style={styles.container}>
        <FieldMeshHeader title="Report" showBack onBackPress={() => router.back()} />
        <ActivityIndicator style={{ marginTop: 40 }} color={FieldMeshColors.primary} />
      </View>
    );
  }

  const allEntries = docHook.allEntries();
  const disputedFieldIds = new Set(docHook.disputedFields());
  const photoFields = CHECKLIST_TEMPLATE.filter((f) => f.type === 'photo');

  return (
    <View style={styles.container}>
      <FieldMeshHeader title="Inspection Report" category="REPORT" showBack onBackPress={() => router.back()} />

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <Text style={styles.title}>{inspection.title}</Text>
          {inspection.site ? <Text style={styles.subtitle}>{inspection.site}</Text> : null}
          <Text style={styles.generated}>Generated {new Date().toLocaleString()}</Text>
        </View>

        <View style={styles.summaryRow}>
          <SummaryTile label="Edits" value={allEntries.length} />
          <SummaryTile label="Fields" value={CHECKLIST_TEMPLATE.length} />
          <SummaryTile label="Disputed" value={disputedFieldIds.size} warn={disputedFieldIds.size > 0} />
          <SummaryTile label="Photos" value={photoFields.filter((f) => docHook.fieldValue(f.fieldId)).length} />
        </View>

        <Text style={styles.sectionLabel}>FIELDS</Text>
        <View style={styles.list}>
          {CHECKLIST_TEMPLATE.map((field) => {
            const value = docHook.fieldValue(field.fieldId);
            const entries = docHook.entriesFor(field.fieldId);
            const isDisputed = disputedFieldIds.has(field.fieldId);
            const last = entries[entries.length - 1];

            return (
              <View key={field.fieldId} style={[styles.fieldRow, isDisputed && styles.fieldRowDisputed]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldTitle}>{field.title}</Text>
                  <Text style={styles.fieldValue}>
                    {field.type === 'photo'
                      ? value
                        ? 'Photo attached'
                        : 'No photo'
                      : value !== undefined
                      ? String(value)
                      : 'Not recorded'}
                  </Text>
                  {last && <Text style={styles.fieldMeta}>Last edited by {last.author} · {entries.length} edit{entries.length === 1 ? '' : 's'}</Text>}
                </View>
                {field.type === 'photo' && value ? (
                  <Image source={{ uri: (value as any).uri }} style={styles.thumb} />
                ) : (
                  <FieldMeshIcon
                    name={isDisputed ? 'warning' : value !== undefined ? 'check_circle' : 'schedule'}
                    size={20}
                    color={isDisputed ? FieldMeshColors.tertiary : value !== undefined ? FieldMeshColors.secondary : FieldMeshColors.outline}
                  />
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function SummaryTile({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <View style={[styles.tile, warn && styles.tileWarn]}>
      <Text style={[styles.tileValue, warn && styles.tileValueWarn]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FieldMeshColors.surface },
  scroll: { flex: 1 },
  content: { padding: FieldMeshSpacing.gutter, gap: FieldMeshSpacing.md },
  headerCard: { gap: 4 },
  title: { fontSize: 20, fontWeight: '700', color: FieldMeshColors.onSurface },
  subtitle: { fontSize: 13, color: FieldMeshColors.onSurfaceVariant },
  generated: { fontSize: 11, fontFamily: 'monospace', color: FieldMeshColors.outline, marginTop: 4 },
  summaryRow: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, backgroundColor: FieldMeshColors.surfaceContainerLow, borderRadius: FieldMeshRadius.md, padding: 10, alignItems: 'center', gap: 2 },
  tileWarn: { backgroundColor: FieldMeshColors.tertiaryFixed },
  tileValue: { fontSize: 20, fontWeight: '700', color: FieldMeshColors.onSurface, fontFamily: 'monospace' },
  tileValueWarn: { color: FieldMeshColors.onTertiaryFixed },
  tileLabel: { fontSize: 10, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant, textTransform: 'uppercase' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: FieldMeshColors.outline, letterSpacing: 0.5, marginTop: 4 },
  list: { gap: 8 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: FieldMeshColors.surfaceLowest,
    borderRadius: FieldMeshRadius.md, padding: 12, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh,
  },
  fieldRowDisputed: { borderColor: FieldMeshColors.tertiaryContainer, backgroundColor: FieldMeshColors.tertiaryFixed },
  fieldTitle: { fontSize: 13.5, fontWeight: '700', color: FieldMeshColors.onSurface },
  fieldValue: { fontSize: 12.5, color: FieldMeshColors.onSurfaceVariant, marginTop: 2 },
  fieldMeta: { fontSize: 10.5, color: FieldMeshColors.outline, marginTop: 3, fontFamily: 'monospace' },
  thumb: { width: 40, height: 40, borderRadius: FieldMeshRadius.sm },
});
