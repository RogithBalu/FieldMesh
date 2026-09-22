import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { TriStateVerdict } from '@/components/fieldmesh/TriStateVerdict';
import { PhotoThumb } from '@/components/fieldmesh/PhotoThumb';
import { templateDefs, type ChecklistField } from '@/constants/checklistTemplate';
import { useAuth } from '@/lib/auth-context';
import { api, errorMessage, NetworkError, type Inspection } from '@/lib/api';
import { useInspectionDoc, defsFrom, type SyncStatus } from '@/lib/useInspectionDoc';
import { buildChecklist, relativeTime } from '@/lib/checklist';
import { ensureUploaded, isPhotoHash, pickPhoto, retryPendingUploads, savePhotoMeta, type PhotoSource } from '@/lib/photos';
import { nameFor } from '@/lib/names';
import { upsertCachedInspection } from '@/lib/inspectionsCache';
import { CHECKLIST_TEMPLATE } from '@/constants/checklistTemplate';

type UploadState = 'uploading' | 'uploaded' | 'queued' | 'failed';

function syncBadge(status: SyncStatus, synced: boolean, unsynced: number, peers: number) {
  if (status === 'connected') {
    return {
      label: synced ? (peers > 0 ? `Live · ${peers + 1} on site` : 'Live sync') : 'Syncing…',
      variant: 'connected' as const,
    };
  }
  if (status === 'connecting') return { label: 'Connecting…', variant: 'warning' as const };
  if (status === 'unauthorized') return { label: 'Sign in again', variant: 'warning' as const };
  return { label: unsynced > 0 ? `Saved on phone · ${unsynced} pending` : 'Saved on phone', variant: 'offline' as const };
}

export default function InspectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, deviceId } = useAuth();

  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverDisputed, setServerDisputed] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [numericDraft, setNumericDraft] = useState<Record<string, string>>({});
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const notesTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const defs = useMemo(() => defsFrom(inspection?.fields, templateDefs()), [inspection]);
  const checklist = useMemo(() => buildChecklist(defs), [defs]);
  const author = useMemo(
    () => (user ? { id: user.id, name: user.name, role: user.role } : null),
    [user]
  );
  const doc = useInspectionDoc(id, deviceId, author, defs);

  // GET /inspections/:id — metadata + field definitions; cached for offline opens.
  // Re-fetched whenever live sync (re)connects so an offline banner clears itself.
  const loadInspection = useCallback(async () => {
    if (!id) return;
    const cacheKey = `fieldmesh:inspection:${id}`;
    try {
      const row = await api.getInspection(id);
      setInspection(row);
      setLoadError(null);
      AsyncStorage.setItem(cacheKey, JSON.stringify(row)).catch(() => {});
      upsertCachedInspection(row, { total: row.fields?.length || CHECKLIST_TEMPLATE.length }).catch(() => {});
    } catch (e) {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) setInspection(JSON.parse(cached));
      setLoadError(e instanceof NetworkError ? 'Offline — showing the copy saved on this phone.' : errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    Promise.resolve().then(loadInspection);
  }, [loadInspection]);

  useEffect(() => {
    if (doc.status === 'connected') Promise.resolve().then(loadInspection);
  }, [doc.status, loadInspection]);

  // GET /inspections/:id/disputes — the server's authoritative verdict, polled while this screen is focused.
  const refreshDisputes = useCallback(async () => {
    if (!id) return;
    try {
      const rows = await api.disputes(id);
      setServerDisputed(new Set(rows.map((r) => r.field_id)));
    } catch {
      /* offline: keep the last known set; local evaluation still flags conflicts */
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      refreshDisputes();
      const t = setInterval(refreshDisputes, 6000);
      return () => clearInterval(t);
    }, [refreshDisputes])
  );

  // After a local edit, ask the server again once it has had time to extract it.
  useEffect(() => {
    if (doc.version === 0) return;
    const t = setTimeout(refreshDisputes, 1500);
    return () => clearTimeout(t);
  }, [doc.version, refreshDisputes]);

  // Photos that failed to upload offline get retried when we're back online.
  useEffect(() => {
    if (doc.status === 'connected' && id) {
      retryPendingUploads(id)
        .then((n) => {
          if (n > 0) setUploads((u) => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v === 'queued' ? 'uploaded' : v])));
        })
        .catch(() => {});
    }
  }, [doc.status, id]);

  const commitNumeric = (field: ChecklistField, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    if (doc.fieldValue(field.fieldId) !== n) doc.setField(field.fieldId, n);
    setNumericDraft((d) => ({ ...d, [field.fieldId]: '' }));
  };

  const scheduleNotes = (field: ChecklistField, text: string) => {
    setNotesDraft((d) => ({ ...d, [field.fieldId]: text }));
    if (notesTimers.current[field.fieldId]) clearTimeout(notesTimers.current[field.fieldId]);
    notesTimers.current[field.fieldId] = setTimeout(() => commitNotes(field, text), 1200);
  };
  const commitNotes = (field: ChecklistField, text: string) => {
    if (notesTimers.current[field.fieldId]) clearTimeout(notesTimers.current[field.fieldId]);
    const trimmed = text.trim();
    const current = doc.fieldValue(field.fieldId);
    if (trimmed && trimmed !== current) doc.setField(field.fieldId, trimmed);
  };

  const handlePhoto = async (field: ChecklistField, source: PhotoSource) => {
    if (!user || !id) return;
    try {
      const picked = await pickPhoto(source, deviceId ?? undefined);
      if (!picked) return;
      const { hash } = picked.value;
      await savePhotoMeta(hash, {
        uri: picked.value.uri!,
        size: picked.value.size,
        width: picked.value.width,
        height: picked.value.height,
        takenAt: picked.value.takenAt,
      });
      // The log stores the content hash; the server dedupes/verifies by it.
      doc.setField(field.fieldId, hash);
      setUploads((u) => ({ ...u, [hash]: 'uploading' }));
      const result = await ensureUploaded(picked.value, picked.bytes, id, user.id);
      setUploads((u) => ({ ...u, [hash]: result === 'queued' ? 'queued' : 'uploaded' }));
    } catch (e) {
      Alert.alert('Photo not attached', errorMessage(e));
    }
  };

  const goResolve = (fieldId: string) =>
    router.push({ pathname: '/(fieldmesh)/inspections/dispute', params: { id: id ?? '', fieldId } });

  if (!id || !user) return null;

  const total = checklist.length;
  const completed = checklist.filter((f) => doc.fieldValue(f.fieldId) !== undefined).length;
  const disputedIds = new Set<string>([...serverDisputed, ...doc.disputedFields()].filter((f) => !f.startsWith('_')));
  const peersOnSite = doc.peers.filter((p) => !p.self).length;
  const badge = syncBadge(doc.status, doc.synced, doc.unsyncedChanges, peersOnSite);

  return (
    <View style={styles.container}>
      <FieldMeshHeader
        title={inspection?.title ?? 'Inspection'}
        category="CHECKLIST"
        showBack
        statusBadge={badge}
        rightAction={
          <Pressable
            onPress={() => router.push({ pathname: '/(fieldmesh)/inspections/history', params: { id } })}
            style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
            testID="open-history"
          >
            <FieldMeshIcon name="history" size={18} color={FieldMeshColors.primary} />
          </Pressable>
        }
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {loadError && (
          <View style={styles.infoBanner}>
            <FieldMeshIcon name="cloud_off" size={16} color={FieldMeshColors.onSurfaceVariant} />
            <Text style={styles.infoBannerText}>{loadError}</Text>
          </View>
        )}
        {doc.status === 'unauthorized' && (
          <View style={styles.warnBanner}>
            <FieldMeshIcon name="warning" size={16} color={FieldMeshColors.onTertiaryFixed} />
            <Text style={styles.warnBannerText}>Live sync refused this session. Sign out and back in to reconnect.</Text>
          </View>
        )}

        {/* Asset context */}
        <View style={styles.contextCard}>
          <View style={styles.contextHeaderRow}>
            <View style={styles.contextHeaderLeft}>
              <Text style={styles.assetCode}>#{id.slice(-6).toUpperCase()}</Text>
              <Text style={styles.assetTitle}>{inspection?.title ?? '…'}</Text>
              {inspection?.site ? <Text style={styles.assetLocation}>{inspection.site}</Text> : null}
            </View>
            <Pressable
              onPress={() => router.push({ pathname: '/(fieldmesh)/mesh', params: { id } })}
              style={[styles.peerBadge, doc.status !== 'connected' && styles.peerBadgeOffline]}
            >
              <View style={[styles.pulsingDot, doc.status !== 'connected' && styles.dotOffline]} />
              <Text style={styles.peerBadgeText}>
                {doc.status === 'connected' ? `On site · ${peersOnSite + 1}` : 'Offline'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.progressCard}>
            <View style={styles.progressRow}>
              <View style={styles.progressNumberGroup}>
                <Text style={styles.progressBigNumber}>{completed}</Text>
                <Text style={styles.progressSubText}>of {total} done</Text>
              </View>
              {disputedIds.size > 0 && (
                <View style={styles.reviewBadge}>
                  <FieldMeshIcon name="warning" size={14} color={FieldMeshColors.tertiary} />
                  <Text style={styles.reviewBadgeText}>
                    {disputedIds.size} item{disputedIds.size === 1 ? '' : 's'} need review
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${total ? (completed / total) * 100 : 0}%` }]} />
            </View>
          </View>
        </View>

        {!doc.ready ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={FieldMeshColors.primary} />
        ) : (
          <View style={styles.itemsStack}>
            {checklist.map((field, idx) => {
              const value = doc.fieldValue(field.fieldId);
              const evaluation = doc.evaluate(field.fieldId);
              const isDisputed = disputedIds.has(field.fieldId);
              const last = doc.latestFor(field.fieldId);
              const disputeText = isDisputed
                ? `${evaluation.heads.length || 2} conflicting entries${evaluation.reason ? ` · ${evaluation.reason}` : ''}`
                : null;

              return (
                <View key={field.fieldId} style={[styles.itemCard, isDisputed && styles.itemCardDisputed]}>
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
                      onVerdictChange={(v) => {
                        if (v !== value) doc.setField(field.fieldId, v);
                      }}
                      disputeInfo={disputeText ? { text: disputeText, onResolvePress: () => goResolve(field.fieldId) } : undefined}
                    />
                  )}

                  {field.type === 'numeric' && (
                    <>
                      <View style={styles.readingTagsRow}>
                        {field.range && (
                          <View style={styles.rangeBadge}>
                            <Text style={styles.rangeBadgeText}>{field.range}</Text>
                          </View>
                        )}
                        {typeof value === 'number' && field.target !== undefined && field.tolerance !== undefined && (
                          <View style={styles.toleranceBadge}>
                            <FieldMeshIcon
                              name={Math.abs(value - field.target) <= field.tolerance ? 'verified' : 'warning'}
                              size={13}
                              color={Math.abs(value - field.target) <= field.tolerance ? FieldMeshColors.secondary : FieldMeshColors.error}
                            />
                            <Text
                              style={[
                                styles.toleranceBadgeText,
                                Math.abs(value - field.target) > field.tolerance && { color: FieldMeshColors.error },
                              ]}
                            >
                              {Math.abs(value - field.target) <= field.tolerance ? 'Within tolerance' : 'Out of tolerance'}
                            </Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.stepperContainer}>
                        <Pressable
                          onPress={() => doc.setField(field.fieldId, Math.max(0, (typeof value === 'number' ? value : field.target ?? 0) - 1))}
                          style={({ pressed }) => [styles.stepperBtn, pressed && styles.pressed]}
                          testID={`dec-${field.fieldId}`}
                        >
                          <FieldMeshIcon name="remove" size={24} color={FieldMeshColors.onSurface} />
                        </Pressable>
                        <View style={styles.stepperValueContainer}>
                          <TextInput
                            style={styles.stepperInput}
                            keyboardType="numeric"
                            value={numericDraft[field.fieldId] || (typeof value === 'number' ? String(value) : '')}
                            placeholder="—"
                            placeholderTextColor={FieldMeshColors.outline}
                            onChangeText={(t) => setNumericDraft((d) => ({ ...d, [field.fieldId]: t }))}
                            onEndEditing={(e) => commitNumeric(field, e.nativeEvent.text)}
                            testID={`num-${field.fieldId}`}
                          />
                          {field.unit && <Text style={styles.stepperUnit}>{field.unit}</Text>}
                        </View>
                        <Pressable
                          onPress={() => doc.setField(field.fieldId, (typeof value === 'number' ? value : field.target ?? 0) + 1)}
                          style={({ pressed }) => [styles.stepperBtn, pressed && styles.pressed]}
                          testID={`inc-${field.fieldId}`}
                        >
                          <FieldMeshIcon name="add" size={24} color={FieldMeshColors.onSurface} />
                        </Pressable>
                      </View>
                      <View style={styles.stepperFooter}>
                        <Text style={styles.stepperFooterText}>Tap the value to type a reading</Text>
                        {field.target !== undefined && (
                          <Text style={styles.stepperFooterText}>
                            Target: {field.target}
                            {field.unit} (±{field.tolerance})
                          </Text>
                        )}
                      </View>
                      {disputeText && (
                        <DisputeRow text={disputeText} onPress={() => goResolve(field.fieldId)} />
                      )}
                    </>
                  )}

                  {(field.type === 'notes' || field.type === 'short_text') && (
                    <>
                      <TextInput
                        style={styles.notesInput}
                        multiline={field.type === 'notes'}
                        placeholder="Add field notes…"
                        placeholderTextColor={FieldMeshColors.outline}
                        value={notesDraft[field.fieldId] ?? (typeof value === 'string' ? value : '')}
                        onChangeText={(t) => scheduleNotes(field, t)}
                        onEndEditing={(e) => commitNotes(field, e.nativeEvent.text)}
                        testID={`notes-${field.fieldId}`}
                      />
                      {disputeText && <DisputeRow text={disputeText} onPress={() => goResolve(field.fieldId)} />}
                    </>
                  )}

                  {field.type === 'photo' && (
                    <>
                      <View style={styles.photoBtnRow}>
                        <Pressable onPress={() => handlePhoto(field, 'camera')} style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]} testID={`camera-${field.fieldId}`}>
                          <FieldMeshIcon name="add_a_photo" size={22} color={FieldMeshColors.onSurface} />
                          <Text style={styles.photoButtonText}>{value ? 'Retake' : 'Take photo'}</Text>
                        </Pressable>
                        <Pressable onPress={() => handlePhoto(field, 'library')} style={({ pressed }) => [styles.photoButtonAlt, pressed && styles.pressed]} testID={`gallery-${field.fieldId}`}>
                          <FieldMeshIcon name="photo_library" size={20} color={FieldMeshColors.primary} />
                          <Text style={styles.photoButtonAltText}>Gallery</Text>
                        </Pressable>
                      </View>
                      {isPhotoHash(value) && (
                        <View style={styles.thumbStrip}>
                          <PhotoThumb hash={value} />
                          <View style={{ flex: 1, gap: 4 }}>
                            <Text style={styles.hashText}>sha256 {value.slice(0, 12)}…</Text>
                            <UploadStatus state={uploads[value]} />
                            {last && <Text style={styles.metaText}>by {nameFor(last.author, last.author === user.id ? user.name : undefined)} · {relativeTime(Number(last.hlc.split(':')[0]))}</Text>}
                          </View>
                        </View>
                      )}
                    </>
                  )}

                  {field.type !== 'photo' && last && (
                    <Text style={styles.metaText}>
                      Last edit by {nameFor(last.author, last.author === user.id ? user.name : undefined)} · {relativeTime(Number(last.hlc.split(':')[0]))} · {doc.entriesFor(field.fieldId).length} edit{doc.entriesFor(field.fieldId).length === 1 ? '' : 's'}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottomDock, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Pressable
          onPress={() =>
            disputedIds.size > 0
              ? goResolve([...disputedIds][0])
              : router.push({ pathname: '/(fieldmesh)/inspections/report', params: { id } })
          }
          style={({ pressed }) => [styles.submitBtn, disputedIds.size > 0 && styles.submitBtnWarn, pressed && styles.pressed]}
          testID="bottom-primary"
        >
          <FieldMeshIcon name={disputedIds.size > 0 ? 'rule' : 'shield'} size={20} color={FieldMeshColors.onPrimary} />
          <Text style={styles.submitBtnText}>
            {disputedIds.size > 0 ? `Review ${disputedIds.size} Dispute${disputedIds.size === 1 ? '' : 's'}` : 'View Report & Sign Off'}
          </Text>
        </Pressable>
        {disputedIds.size > 0 && (
          <Pressable onPress={() => router.push({ pathname: '/(fieldmesh)/inspections/report', params: { id } })} style={styles.secondaryLink} testID="open-report">
            <Text style={styles.secondaryLinkText}>View report</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function DisputeRow({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <View style={styles.disputeInline}>
      <FieldMeshIcon name="rule" size={16} color={FieldMeshColors.tertiary} />
      <Text style={styles.disputeInlineText} numberOfLines={2}>
        {text}
      </Text>
      <Pressable onPress={onPress} style={styles.resolveBtn}>
        <Text style={styles.resolveBtnText}>Resolve</Text>
      </Pressable>
    </View>
  );
}

function UploadStatus({ state }: { state?: UploadState }) {
  const map: Record<UploadState, { icon: string; text: string; color: string }> = {
    uploading: { icon: 'cloud_upload', text: 'Uploading to server…', color: FieldMeshColors.onSurfaceVariant },
    uploaded: { icon: 'cloud_done', text: 'Verified on server', color: FieldMeshColors.secondary },
    queued: { icon: 'cloud_off', text: 'Queued — uploads when online', color: FieldMeshColors.onTertiaryFixedVariant },
    failed: { icon: 'sync_problem', text: 'Upload failed', color: FieldMeshColors.error },
  };
  const m = state ? map[state] : { icon: 'cloud_done', text: 'On server', color: FieldMeshColors.onSurfaceVariant };
  return (
    <View style={styles.uploadRow}>
      <FieldMeshIcon name={m.icon} size={14} color={m.color} />
      <Text style={[styles.uploadText, { color: m.color }]}>{m.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FieldMeshColors.surface },
  scroll: { flex: 1 },
  content: { padding: FieldMeshSpacing.gutter, gap: FieldMeshSpacing.md },
  headerBtn: { width: 34, height: 34, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  infoBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: FieldMeshColors.surfaceContainerHigh, padding: 10, borderRadius: FieldMeshRadius.md },
  infoBannerText: { flex: 1, fontSize: 12, fontWeight: '600', color: FieldMeshColors.onSurfaceVariant },
  warnBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: FieldMeshColors.tertiaryFixed, padding: 10, borderRadius: FieldMeshRadius.md },
  warnBannerText: { flex: 1, fontSize: 12, fontWeight: '600', color: FieldMeshColors.onTertiaryFixed },
  contextCard: { backgroundColor: FieldMeshColors.surfaceLowest, padding: FieldMeshSpacing.md, borderRadius: FieldMeshRadius.lg, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh, gap: 12 },
  contextHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  contextHeaderLeft: { flex: 1, paddingRight: 8 },
  assetCode: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant, letterSpacing: 0.5 },
  assetTitle: { fontSize: 17, fontWeight: '700', color: FieldMeshColors.onSurface, marginTop: 2 },
  assetLocation: { fontSize: 13, color: FieldMeshColors.onSurfaceVariant, marginTop: 2 },
  peerBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: FieldMeshColors.secondaryFixed, paddingHorizontal: 10, paddingVertical: 5, borderRadius: FieldMeshRadius.full },
  peerBadgeOffline: { backgroundColor: FieldMeshColors.surfaceContainerHigh },
  pulsingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: FieldMeshColors.secondary },
  dotOffline: { backgroundColor: FieldMeshColors.outline },
  peerBadgeText: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', color: FieldMeshColors.onSurface },
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
  itemCardDisputed: { borderColor: FieldMeshColors.tertiaryFixedDim },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  itemHeaderLeft: { flex: 1, paddingRight: 8 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onSurface },
  itemDesc: { fontSize: 13, color: FieldMeshColors.onSurfaceVariant, marginTop: 3, lineHeight: 18 },
  critBadge: { backgroundColor: FieldMeshColors.surfaceContainerHighest, paddingHorizontal: 8, paddingVertical: 2, borderRadius: FieldMeshRadius.xs },
  critBadgeText: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant },
  readingTagsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rangeBadge: { backgroundColor: FieldMeshColors.tertiaryFixed, paddingHorizontal: 8, paddingVertical: 2, borderRadius: FieldMeshRadius.xs },
  rangeBadgeText: { fontSize: 11, fontWeight: '700', color: FieldMeshColors.onTertiaryFixed },
  toleranceBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  toleranceBadgeText: { fontSize: 12, fontWeight: '600', color: FieldMeshColors.secondary },
  stepperContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: FieldMeshColors.surfaceContainerLow, padding: 6, borderRadius: FieldMeshRadius.lg },
  stepperBtn: { width: 54, height: 54, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainerHighest, alignItems: 'center', justifyContent: 'center' },
  stepperValueContainer: { flex: 1, height: 54, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceLowest, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  stepperInput: { fontSize: 28, fontWeight: '700', fontFamily: 'monospace', color: FieldMeshColors.onSurface, minWidth: 60, textAlign: 'center', padding: 0 },
  stepperUnit: { fontSize: 16, fontWeight: '600', color: FieldMeshColors.onSurfaceVariant, marginBottom: 4 },
  stepperFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stepperFooterText: { fontFamily: 'monospace', fontSize: 11, color: FieldMeshColors.onSurfaceVariant },
  notesInput: { backgroundColor: FieldMeshColors.surfaceContainerLow, padding: 12, borderRadius: FieldMeshRadius.md, fontSize: 13, color: FieldMeshColors.onSurface, textAlignVertical: 'top', minHeight: 70 },
  photoBtnRow: { flexDirection: 'row', gap: 8 },
  photoButton: { flex: 2, height: 52, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainerHighest, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoButtonText: { fontSize: 14, fontWeight: '700', color: FieldMeshColors.onSurface },
  photoButtonAlt: { flex: 1, height: 52, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainerLow, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh },
  photoButtonAltText: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.primary },
  thumbStrip: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  hashText: { fontFamily: 'monospace', fontSize: 11, color: FieldMeshColors.onSurfaceVariant },
  uploadRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  uploadText: { fontSize: 11, fontWeight: '600' },
  metaText: { fontFamily: 'monospace', fontSize: 10.5, color: FieldMeshColors.outline },
  disputeInline: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: FieldMeshColors.tertiaryFixed, padding: 8, paddingLeft: 10, borderRadius: FieldMeshRadius.md },
  disputeInlineText: { flex: 1, fontSize: 12, fontWeight: '600', color: FieldMeshColors.onTertiaryFixed },
  resolveBtn: { backgroundColor: FieldMeshColors.tertiaryContainer, paddingHorizontal: 10, paddingVertical: 5, borderRadius: FieldMeshRadius.sm },
  resolveBtnText: { fontSize: 12, fontWeight: '700', color: FieldMeshColors.onTertiary },
  bottomDock: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: FieldMeshColors.surface, paddingHorizontal: FieldMeshSpacing.gutter, paddingTop: 10, borderTopWidth: 1, borderTopColor: FieldMeshColors.surfaceContainerHigh, gap: 6 },
  submitBtn: { height: 54, borderRadius: FieldMeshRadius.lg, backgroundColor: FieldMeshColors.primaryContainer, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitBtnWarn: { backgroundColor: FieldMeshColors.tertiaryContainer },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onPrimary },
  secondaryLink: { alignItems: 'center', paddingVertical: 4 },
  secondaryLinkText: { fontSize: 12, fontWeight: '700', color: FieldMeshColors.primary },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
