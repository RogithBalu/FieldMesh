import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Image, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { TriStateVerdict } from '@/components/fieldmesh/TriStateVerdict';
import { CHECKLIST_TEMPLATE } from '@/constants/checklistTemplate';
import { useAuth } from '@/lib/auth-context';
import { useInspectionDoc } from '@/lib/useInspectionDoc';
import * as db from '@/lib/localdb';

interface PhotoValue {
  uri: string;
  hash: string;
}

export default function InspectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, deviceId } = useAuth();

  const [inspection, setInspection] = useState<db.Inspection | null>(null);
  const docHook = useInspectionDoc(id, deviceId, user?.name ?? null);

  useEffect(() => {
    if (id) db.getInspection(id).then((i) => setInspection(i ?? null));
  }, [id]);

  const completed = CHECKLIST_TEMPLATE.filter((f) => docHook.fieldValue(f.fieldId) !== undefined).length;
  const total = CHECKLIST_TEMPLATE.length;
  const disputed = new Set(docHook.disputedFields());

  const handlePhoto = async (fieldId: string) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Enable camera access to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: false });
    if (result.canceled || !result.assets[0]) return;

    const uri = result.assets[0].uri;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64, {
      encoding: Crypto.CryptoEncoding.HEX,
    });
    docHook.setField(fieldId, { uri, hash } as PhotoValue);
  };

  const handleSimulateConflict = (fieldId: string, currentValue: unknown) => {
    if (!user) return;
    const alt =
      typeof currentValue === 'boolean' || currentValue === 'pass' || currentValue === 'fail'
        ? currentValue === 'fail'
          ? 'pass'
          : 'fail'
        : typeof currentValue === 'number'
        ? currentValue + 15
        : `${currentValue ?? ''} (alternate reading)`.trim();
    docHook.simulateConcurrentEdit(fieldId, alt, 'Priya (simulated)', 'simulated-device');
  };

  if (!inspection) {
    return (
      <View style={styles.container}>
        <FieldMeshHeader title="Inspection" category="LOADING" showBack onBackPress={() => router.back()} />
        <ActivityIndicator style={{ marginTop: 40 }} color={FieldMeshColors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FieldMeshHeader
        title="Inspection Details"
        category="CHECKLIST"
        showBack
        onBackPress={() => router.back()}
        statusBadge={{ label: 'Saved on phone', variant: 'offline' }}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contextCard}>
          <Text style={styles.assetCode}>#{inspection.id.slice(-6).toUpperCase()}</Text>
          <Text style={styles.assetTitle}>{inspection.title}</Text>
          {inspection.site ? <Text style={styles.assetLocation}>{inspection.site}</Text> : null}

          <View style={styles.progressCard}>
            <View style={styles.progressRow}>
              <View style={styles.progressNumberGroup}>
                <Text style={styles.progressBigNumber}>{completed}</Text>
                <Text style={styles.progressSubText}>of {total} done</Text>
              </View>
              {disputed.size > 0 && (
                <View style={styles.reviewBadge}>
                  <FieldMeshIcon name="warning" size={14} color={FieldMeshColors.tertiary} />
                  <Text style={styles.reviewBadgeText}>
                    {disputed.size} item{disputed.size === 1 ? '' : 's'} need review
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${total ? (completed / total) * 100 : 0}%` }]} />
            </View>
          </View>
        </View>

        <View style={styles.itemsStack}>
          {CHECKLIST_TEMPLATE.map((field, idx) => {
            const value = docHook.fieldValue(field.fieldId);
            const isDisputed = disputed.has(field.fieldId);
            const entries = docHook.entriesFor(field.fieldId);
            const heads = entries.filter((e) => docHook.disputedFields().includes(field.fieldId));

            return (
              <View key={field.fieldId} style={styles.itemCard}>
                <View style={styles.itemHeader}>
                  <View style={styles.itemHeaderLeft}>
                    <Text style={styles.itemTitle}>
                      {idx + 1}. {field.title}
                    </Text>
                    <Text style={styles.itemDesc}>{field.description}</Text>
                  </View>
                  <View style={styles.critBadge}>
                    <Text style={styles.critBadgeText}>{field.code}</Text>
                  </View>
                </View>

                {field.type === 'pass_fail' && (
                  <TriStateVerdict
                    verdict={value === 'pass' || value === 'fail' ? value : null}
                    onVerdictChange={(v) => docHook.setField(field.fieldId, v)}
                    disputeInfo={
                      isDisputed
                        ? {
                            text: `${entries.length} conflicting entries logged`,
                            onResolvePress: () =>
                              router.push({
                                pathname: '/(fieldmesh)/inspections/dispute',
                                params: { id: inspection.id, fieldId: field.fieldId },
                              }),
                          }
                        : undefined
                    }
                  />
                )}

                {field.type === 'numeric' && (
                  <>
                    {field.range && (
                      <View style={styles.readingTagsRow}>
                        <View style={styles.rangeBadge}>
                          <Text style={styles.rangeBadgeText}>{field.range}</Text>
                        </View>
                      </View>
                    )}
                    <View style={styles.stepperContainer}>
                      <Pressable
                        onPress={() => docHook.setField(field.fieldId, Math.max(0, (Number(value) || field.target || 0) - 1))}
                        style={({ pressed }) => [styles.stepperBtn, pressed && styles.buttonPressed]}
                      >
                        <FieldMeshIcon name="remove" size={24} color={FieldMeshColors.onSurface} />
                      </Pressable>
                      <View style={styles.stepperValueContainer}>
                        <Text style={styles.stepperValue}>{value !== undefined ? Number(value) : '—'}</Text>
                        {field.unit && <Text style={styles.stepperUnit}>{field.unit}</Text>}
                      </View>
                      <Pressable
                        onPress={() => docHook.setField(field.fieldId, (Number(value) || field.target || 0) + 1)}
                        style={({ pressed }) => [styles.stepperBtn, pressed && styles.buttonPressed]}
                      >
                        <FieldMeshIcon name="add" size={24} color={FieldMeshColors.onSurface} />
                      </Pressable>
                    </View>
                    {field.target !== undefined && (
                      <Text style={styles.stepperFooterText}>
                        Target: {field.target}
                        {field.unit} (±{field.tolerance})
                      </Text>
                    )}
                    {isDisputed && (
                      <View style={styles.disputeInline}>
                        <FieldMeshIcon name="rule" size={16} color={FieldMeshColors.tertiary} />
                        <Text style={styles.disputeInlineText}>Readings disagree beyond tolerance</Text>
                        <Pressable
                          onPress={() =>
                            router.push({
                              pathname: '/(fieldmesh)/inspections/dispute',
                              params: { id: inspection.id, fieldId: field.fieldId },
                            })
                          }
                        >
                          <Text style={styles.resolveLink}>Resolve</Text>
                        </Pressable>
                      </View>
                    )}
                  </>
                )}

                {field.type === 'notes' && (
                  <TextInput
                    style={styles.notesInput}
                    multiline
                    numberOfLines={3}
                    placeholder="Add field notes…"
                    placeholderTextColor={FieldMeshColors.outline}
                    value={typeof value === 'string' ? value : ''}
                    onChangeText={(t) => docHook.setField(field.fieldId, t)}
                  />
                )}

                {field.type === 'photo' && (
                  <>
                    <Pressable
                      onPress={() => handlePhoto(field.fieldId)}
                      style={({ pressed }) => [styles.photoButton, pressed && styles.buttonPressed]}
                    >
                      <FieldMeshIcon name="add_a_photo" size={22} color={FieldMeshColors.onSurface} />
                      <Text style={styles.photoButtonText}>
                        {value ? 'Retake photo' : '+ Take photo'}
                      </Text>
                    </Pressable>
                    {value && (
                      <View style={styles.thumbStrip}>
                        <View style={styles.thumbContainer}>
                          <Image source={{ uri: (value as PhotoValue).uri }} style={styles.thumbImage} />
                        </View>
                        <Text style={styles.hashText}>{(value as PhotoValue).hash.slice(0, 16)}…</Text>
                      </View>
                    )}
                  </>
                )}

                <Pressable onPress={() => handleSimulateConflict(field.fieldId, value)} hitSlop={6}>
                  <Text style={styles.simulateLink}>Simulate teammate edit (demo)</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.bottomDock, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Pressable
          onPress={() => router.push({ pathname: '/(fieldmesh)/inspections/report', params: { id: inspection.id } })}
          style={({ pressed }) => [styles.submitBtn, pressed && styles.buttonPressed]}
        >
          <FieldMeshIcon name="shield" size={20} color={FieldMeshColors.onPrimary} />
          <Text style={styles.submitBtnText}>
            {disputed.size > 0 ? `Review ${disputed.size} Dispute${disputed.size === 1 ? '' : 's'} & View Report` : 'View Report'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FieldMeshColors.surface },
  scroll: { flex: 1 },
  content: { padding: FieldMeshSpacing.gutter, gap: FieldMeshSpacing.md },
  contextCard: {
    backgroundColor: FieldMeshColors.surfaceLowest, padding: FieldMeshSpacing.md, borderRadius: FieldMeshRadius.lg,
    borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh, gap: 12,
  },
  assetCode: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant, letterSpacing: 0.5 },
  assetTitle: { fontSize: 17, fontWeight: '700', color: FieldMeshColors.onSurface, marginTop: 2 },
  assetLocation: { fontSize: 13, color: FieldMeshColors.onSurfaceVariant, marginTop: 2 },
  progressCard: { backgroundColor: FieldMeshColors.surfaceContainerLow, padding: 12, borderRadius: FieldMeshRadius.md, gap: 8 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressNumberGroup: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  progressBigNumber: { fontSize: 22, fontWeight: '700', color: FieldMeshColors.onSurface, fontFamily: 'monospace' },
  progressSubText: { fontSize: 13, color: FieldMeshColors.onSurfaceVariant, fontWeight: '600' },
  reviewBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: FieldMeshColors.tertiaryFixed, paddingHorizontal: 8, paddingVertical: 3, borderRadius: FieldMeshRadius.full },
  reviewBadgeText: { fontSize: 11, fontWeight: '700', color: FieldMeshColors.onTertiaryFixed },
  progressBar: { height: 8, borderRadius: 4, backgroundColor: FieldMeshColors.surfaceContainerHighest, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: FieldMeshColors.primary },
  itemsStack: { gap: FieldMeshSpacing.md },
  itemCard: { backgroundColor: FieldMeshColors.surfaceLowest, padding: FieldMeshSpacing.md, borderRadius: FieldMeshRadius.lg, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh, gap: 12 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  itemHeaderLeft: { flex: 1, paddingRight: 8 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onSurface },
  itemDesc: { fontSize: 13, color: FieldMeshColors.onSurfaceVariant, marginTop: 3, lineHeight: 18 },
  critBadge: { backgroundColor: FieldMeshColors.surfaceContainerHighest, paddingHorizontal: 8, paddingVertical: 2, borderRadius: FieldMeshRadius.xs },
  critBadgeText: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant },
  readingTagsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rangeBadge: { backgroundColor: FieldMeshColors.tertiaryFixed, paddingHorizontal: 8, paddingVertical: 2, borderRadius: FieldMeshRadius.xs },
  rangeBadgeText: { fontSize: 11, fontWeight: '700', color: FieldMeshColors.onTertiaryFixed },
  stepperContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: FieldMeshColors.surfaceContainerLow, padding: 6, borderRadius: FieldMeshRadius.lg },
  stepperBtn: { width: 54, height: 54, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainerHighest, alignItems: 'center', justifyContent: 'center' },
  stepperValueContainer: { flex: 1, height: 54, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceLowest, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  stepperValue: { fontSize: 28, fontWeight: '700', fontFamily: 'monospace', color: FieldMeshColors.onSurface },
  stepperUnit: { fontSize: 16, fontWeight: '600', color: FieldMeshColors.onSurfaceVariant, marginBottom: 4 },
  stepperFooterText: { fontFamily: 'monospace', fontSize: 11, color: FieldMeshColors.onSurfaceVariant },
  notesInput: { backgroundColor: FieldMeshColors.surfaceContainerLow, padding: 12, borderRadius: FieldMeshRadius.md, fontSize: 13, color: FieldMeshColors.onSurface, textAlignVertical: 'top', minHeight: 70 },
  photoButton: { height: 52, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainerHighest, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoButtonText: { fontSize: 14, fontWeight: '700', color: FieldMeshColors.onSurface },
  thumbStrip: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  thumbContainer: { width: 76, height: 76, borderRadius: FieldMeshRadius.md, overflow: 'hidden', backgroundColor: FieldMeshColors.surfaceContainerHigh },
  thumbImage: { width: '100%', height: '100%' },
  hashText: { fontFamily: 'monospace', fontSize: 11, color: FieldMeshColors.onSurfaceVariant },
  disputeInline: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: FieldMeshColors.tertiaryFixed, padding: 10, borderRadius: FieldMeshRadius.md },
  disputeInlineText: { flex: 1, fontSize: 12, fontWeight: '600', color: FieldMeshColors.onTertiaryFixed },
  resolveLink: { fontSize: 12, fontWeight: '700', color: FieldMeshColors.onTertiaryFixed, textDecorationLine: 'underline' },
  simulateLink: { fontSize: 11, color: FieldMeshColors.outline, fontStyle: 'italic', textAlign: 'right' },
  bottomDock: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: FieldMeshColors.surface, paddingHorizontal: FieldMeshSpacing.gutter, paddingTop: 10, borderTopWidth: 1, borderTopColor: FieldMeshColors.surfaceContainerHigh },
  submitBtn: { height: 54, borderRadius: FieldMeshRadius.lg, backgroundColor: FieldMeshColors.primaryContainer, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onPrimary },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
