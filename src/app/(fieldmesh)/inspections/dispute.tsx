import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { CHECKLIST_TEMPLATE } from '@/constants/checklistTemplate';
import { useAuth } from '@/lib/auth-context';
import { useInspectionDoc } from '@/lib/useInspectionDoc';

export default function DisputeScreen() {
  const { id, fieldId } = useLocalSearchParams<{ id: string; fieldId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, deviceId } = useAuth();
  const docHook = useInspectionDoc(id, deviceId, user?.name ?? null);

  const field = CHECKLIST_TEMPLATE.find((f) => f.fieldId === fieldId);
  const heads = docHook.disputedFields().includes(fieldId ?? '')
    ? docHook.entriesFor(fieldId ?? '').filter((e) => {
        const allInField = docHook.entriesFor(fieldId ?? '');
        const superseded = new Set(allInField.flatMap((x) => x.parents));
        return !superseded.has(e.id);
      })
    : [];

  const [overrideNotes, setOverrideNotes] = useState('');
  const [chosenValue, setChosenValue] = useState<unknown>(heads[0]?.value);

  if (!field) {
    return (
      <View style={styles.container}>
        <FieldMeshHeader title="Dispute" showBack onBackPress={() => router.back()} />
      </View>
    );
  }

  const handleResolve = (value: unknown) => {
    docHook.setField(field.fieldId, value);
    Alert.alert('Dispute Resolved', 'The new value supersedes both conflicting entries and closes the dispute.', [
      { text: 'Back to Checklist', onPress: () => router.back() },
    ]);
  };

  return (
    <View style={styles.container}>
      <FieldMeshHeader title="Resolve Dispute" category="RESOLUTION" showBack onBackPress={() => router.back()} statusBadge={{ label: 'Saved on phone', variant: 'offline' }} />

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.itemHeader}>
          <Text style={styles.itemTag}>{field.code} · {field.title}</Text>
          <Text style={styles.itemTitle}>{field.description}</Text>
        </View>

        <View style={styles.conflictCard}>
          <View style={styles.conflictHeaderRow}>
            <View style={styles.warningIconCircle}>
              <FieldMeshIcon name="warning" size={20} color={FieldMeshColors.tertiaryFixed} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.conflictTitle}>Conflicting entries detected</Text>
              <Text style={styles.conflictSubtitle}>{heads.length} concurrent edits with no shared history</Text>
            </View>
          </View>

          <View style={styles.splitGrid}>
            {heads.map((h) => (
              <Pressable
                key={h.id}
                style={[styles.recordBox, chosenValue === h.value && styles.recordBoxSelected]}
                onPress={() => setChosenValue(h.value)}
              >
                <Text style={styles.peerName}>{h.author}</Text>
                <Text style={styles.peerDevice}>{h.device}</Text>
                <Text style={styles.valueText} numberOfLines={4}>
                  {String(h.value)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.decisionSection}>
          <Text style={styles.decisionLabel}>PICK A FINAL VALUE, OR ENTER YOUR OWN</Text>
          <TextInput
            style={styles.overrideInput}
            multiline
            placeholder="Enter the resolved value…"
            placeholderTextColor={FieldMeshColors.outline}
            value={typeof chosenValue === 'string' || typeof chosenValue === 'number' ? String(chosenValue) : ''}
            onChangeText={setChosenValue}
          />

          <Pressable
            onPress={() => handleResolve(chosenValue)}
            style={({ pressed }) => [styles.confirmBtn, pressed && styles.btnPressed]}
          >
            <FieldMeshIcon name="check_circle" size={20} color={FieldMeshColors.onPrimary} />
            <Text style={styles.confirmBtnText}>Confirm Resolution</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FieldMeshColors.surface },
  scroll: { flex: 1 },
  content: { padding: FieldMeshSpacing.gutter, gap: FieldMeshSpacing.md },
  itemHeader: { gap: 4 },
  itemTag: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant },
  itemTitle: { fontSize: 18, fontWeight: '700', color: FieldMeshColors.onSurface },
  conflictCard: { backgroundColor: FieldMeshColors.tertiaryFixed, borderRadius: FieldMeshRadius.lg, padding: FieldMeshSpacing.md, gap: 12 },
  conflictHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  warningIconCircle: { width: 32, height: 32, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.tertiaryContainer, alignItems: 'center', justifyContent: 'center' },
  conflictTitle: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onTertiaryFixed },
  conflictSubtitle: { fontSize: 12, color: FieldMeshColors.onTertiaryFixedVariant, marginTop: 1 },
  splitGrid: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  recordBox: { flex: 1, minWidth: 130, backgroundColor: FieldMeshColors.surfaceLowest, borderRadius: FieldMeshRadius.md, padding: 10, gap: 6, borderWidth: 1.5, borderColor: 'transparent' },
  recordBoxSelected: { borderColor: FieldMeshColors.primary },
  peerName: { fontSize: 12, fontWeight: '700', color: FieldMeshColors.onSurface },
  peerDevice: { fontSize: 10, color: FieldMeshColors.onSurfaceVariant },
  valueText: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.onSurface, marginTop: 4 },
  decisionSection: { gap: 10 },
  decisionLabel: { fontSize: 11, fontWeight: '700', color: FieldMeshColors.outline, letterSpacing: 0.5 },
  overrideInput: { backgroundColor: FieldMeshColors.surfaceContainer, borderRadius: FieldMeshRadius.md, padding: 12, fontSize: 14, color: FieldMeshColors.onSurface, minHeight: 60, textAlignVertical: 'top' },
  confirmBtn: { height: 54, borderRadius: FieldMeshRadius.lg, backgroundColor: FieldMeshColors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  confirmBtnText: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onPrimary },
  btnPressed: { opacity: 0.88, transform: [{ scale: 0.985 }] },
});
