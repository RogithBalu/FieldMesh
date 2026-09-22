import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { PhotoThumb } from '@/components/fieldmesh/PhotoThumb';
import { templateDefs } from '@/constants/checklistTemplate';
import { useAuth } from '@/lib/auth-context';
import { api, canReview, errorMessage, type EditRow, type Inspection } from '@/lib/api';
import { useInspectionDoc, defsFrom } from '@/lib/useInspectionDoc';
import { buildChecklist, fieldTitle, formatTime, RESOLUTION_NOTES_FIELD } from '@/lib/checklist';
import { decodeHlc } from '@/lib/editlog/hlc';
import { isPhotoHash } from '@/lib/photos';
import { nameFor } from '@/lib/names';

interface Head {
  editId: string;
  value: string;
  author: string;
  device: string;
  wall: number;
  fromServer: boolean;
}

/**
 * Dispute resolution for one field.
 *  - Heads come from GET /inspections/:id/disputes (server verdict), with the
 *    live document's concurrent heads as the offline fallback.
 *  - Resolving calls POST /inspections/:id/resolve, which writes an edit whose
 *    parents are every disputed head, closing the dispute for everyone.
 *  - Offline (or when the server doesn't consider the field disputed), the
 *    resolution is recorded as a local edit that supersedes all local heads.
 */
export default function DisputeScreen() {
  const { id, fieldId } = useLocalSearchParams<{ id: string; fieldId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, deviceId } = useAuth();

  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [serverRows, setServerRows] = useState<EditRow[] | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideNotes, setOverrideNotes] = useState('');
  const [chosen, setChosen] = useState<string>('');

  const defs = useMemo(() => defsFrom(inspection?.fields, templateDefs()), [inspection]);
  const field = useMemo(() => buildChecklist(defs).find((f) => f.fieldId === fieldId), [defs, fieldId]);
  const author = useMemo(() => (user ? { id: user.id, name: user.name, role: user.role } : null), [user]);
  /** The server enforces this too; here it only keeps the buttons honest. */
  const mayReview = canReview(user?.role);
  const isFinalized = !!inspection?.finalized_at;
  const canAct = mayReview && !isFinalized && !resolving;
  const doc = useInspectionDoc(id, deviceId, author, defs);

  useEffect(() => {
    if (!id) return;
    api.getInspection(id).then(setInspection).catch(() => {});
  }, [id]);

  const loadDisputes = useCallback(async () => {
    if (!id || !fieldId) return;
    try {
      const rows = await api.disputes(id);
      setServerRows(rows.filter((r) => r.field_id === fieldId));
      setServerError(null);
    } catch (e) {
      setServerRows((r) => r ?? []);
      setServerError(errorMessage(e));
    }
  }, [id, fieldId]);

  useEffect(() => {
    // Run from a microtask so the state updates happen in a callback, not the effect body.
    Promise.resolve().then(loadDisputes);
  }, [loadDisputes]);

  const heads: Head[] = useMemo(() => {
    if (serverRows && serverRows.length > 0) {
      return serverRows
        .map((r) => ({ editId: r.edit_id, value: r.value ?? '', author: r.author, device: r.device, wall: decodeHlc(r.hlc).wall, fromServer: true }))
        .sort((a, b) => a.wall - b.wall);
    }
    if (!fieldId) return [];
    return doc
      .headEntriesFor(fieldId)
      .map((e) => ({ editId: e.id, value: e.value == null ? '' : String(e.value), author: e.author, device: e.device, wall: decodeHlc(e.hlc).wall, fromServer: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRows, fieldId, doc.version]);

  const serverDisputed = (serverRows?.length ?? 0) > 0;
  const isPassFail = field?.type === 'pass_fail';
  const isNumeric = field?.type === 'numeric';

  const resolve = async (value: unknown, note?: string) => {
    if (!id || !fieldId || !user) return;
    setResolving(true);
    try {
      if (serverDisputed) {
        await api.resolve(id, { fieldId, value, device: deviceId ?? 'app', schemaVersion: inspection?.schema_version ?? 1 });
      } else {
        doc.setField(fieldId, value);
      }
      if (note?.trim()) {
        doc.setField(RESOLUTION_NOTES_FIELD, `${fieldTitle(fieldId)} → ${String(value)}: ${note.trim()}`);
      }
      Alert.alert(
        serverDisputed ? 'Resolution signed' : 'Resolution recorded',
        serverDisputed
          ? `"${String(value)}" is now the authoritative value. Every device on this inspection receives it over sync.`
          : `"${String(value)}" supersedes the conflicting entries on this phone and will sync when the server is reachable.`,
        [{ text: 'Back to checklist', onPress: () => router.back() }]
      );
    } catch (e) {
      Alert.alert('Could not resolve', errorMessage(e));
      loadDisputes();
    } finally {
      setResolving(false);
    }
  };

  const handleConfirmFail = () => resolve('fail');
  const handleConfirmPass = () => {
    if (!overrideNotes.trim()) {
      Alert.alert('Explanation required', 'Enter an authorized justification to override a safety FAIL.');
      return;
    }
    resolve('pass', overrideNotes);
  };
  const handleGenericResolve = () => {
    const raw = chosen.trim();
    if (!raw) {
      Alert.alert('Pick a value', 'Choose one of the conflicting entries or enter the resolved value.');
      return;
    }
    if (isNumeric) {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        Alert.alert('Invalid number', 'Enter a numeric reading.');
        return;
      }
      resolve(n, overrideNotes);
      return;
    }
    resolve(raw, overrideNotes);
  };

  if (!id || !fieldId || !user) return null;

  return (
    <View style={styles.container}>
      <FieldMeshHeader
        title="Safety Dispute"
        category="RESOLUTION"
        showBack
        statusBadge={
          serverRows === null
            ? { label: 'Checking server…', variant: 'warning' }
            : serverDisputed
              ? { label: 'Server flagged', variant: 'warning' }
              : { label: serverError ? 'Offline' : 'Local conflict', variant: 'offline' }
        }
      />

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.contextBar}>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <FieldMeshIcon name="chevron_left" size={20} color={FieldMeshColors.primary} />
            <Text style={styles.backLinkText}>Back to checklist</Text>
          </Pressable>
          <View style={styles.relayBadge}>
            <View style={[styles.relayDot, doc.status !== 'connected' && { backgroundColor: FieldMeshColors.outline }]} />
            <Text style={styles.relayText}>{doc.status === 'connected' ? 'Live sync' : 'Offline'}</Text>
          </View>
        </View>

        <View style={styles.itemHeader}>
          <View style={styles.itemTagRow}>
            <Text style={styles.itemTag}>
              {field?.code ?? fieldId} · {inspection?.title ?? 'Inspection'}
            </Text>
            <FieldMeshIcon name="gpp_maybe" size={18} color={FieldMeshColors.error} />
          </View>
          <Text style={styles.itemTitle}>{field?.title ?? fieldTitle(fieldId)}</Text>
          {inspection?.site ? (
            <View style={styles.locationRow}>
              <FieldMeshIcon name="location_on" size={16} color={FieldMeshColors.outline} />
              <Text style={styles.locationText}>{inspection.site}</Text>
            </View>
          ) : null}
        </View>

        {serverError && (
          <View style={styles.infoBanner}>
            <FieldMeshIcon name="cloud_off" size={16} color={FieldMeshColors.onSurfaceVariant} />
            <Text style={styles.infoBannerText}>{serverError} Showing the conflict as this phone sees it.</Text>
          </View>
        )}

        <View style={styles.conflictCard}>
          <View style={styles.conflictHeader}>
            <View style={styles.warningIconCircle}>
              <FieldMeshIcon name="warning" size={20} color={FieldMeshColors.tertiaryFixed} />
            </View>
            <View style={styles.conflictHeaderText}>
              <Text style={styles.conflictTitle}>{heads.length > 1 ? 'Conflicting inputs detected' : serverRows === null ? 'Loading…' : 'No open conflict'}</Text>
              <Text style={styles.conflictSubtitle}>
                {heads.length > 1
                  ? `${heads.length} entries made without seeing each other${serverDisputed ? ' · flagged by server' : ''}`
                  : 'This field has a single current value.'}
              </Text>
            </View>
          </View>

          <View style={styles.splitGrid}>
            {heads.map((h) => {
              const isFail = h.value === 'fail';
              const selected = chosen === h.value && !isPassFail;
              return (
                <Pressable
                  key={h.editId}
                  onPress={() => !isPassFail && setChosen(h.value)}
                  style={[styles.recordBox, isFail && styles.recordBoxAlert, selected && styles.recordBoxSelected]}
                >
                  <View style={styles.peerRow}>
                    <View style={[styles.peerAvatar, isFail && styles.avatarAlert]}>
                      <Text style={[styles.peerInitial, isFail && styles.textAlert]}>
                        {nameFor(h.author, h.author === user.id ? user.name : undefined).slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.peerInfo}>
                      <Text style={styles.peerName} numberOfLines={1}>
                        {nameFor(h.author, h.author === user.id ? user.name : undefined)}
                      </Text>
                      <Text style={styles.peerDevice} numberOfLines={1}>
                        {h.device}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.timeRow}>
                    <FieldMeshIcon name="schedule" size={13} color={FieldMeshColors.onSurfaceVariant} />
                    <Text style={styles.timeText}>{formatTime(h.wall)}</Text>
                  </View>
                  {isPhotoHash(h.value) ? (
                    <PhotoThumb hash={h.value} size={64} style={{ alignSelf: 'center' }} />
                  ) : (
                    <View style={isFail ? styles.verdictDisplayFail : styles.verdictDisplayPass}>
                      <Text style={isFail ? styles.failText : styles.passText} numberOfLines={4}>
                        {h.value === '' ? '(empty)' : h.value}
                        {isNumeric && field?.unit && h.value !== '' ? field.unit : ''}
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        {isPassFail && (
          <View style={styles.safetyRuleBanner}>
            <View style={styles.safetyIconContainer}>
              <FieldMeshIcon name="shield" size={18} color={FieldMeshColors.onError} />
            </View>
            <View style={styles.safetyRuleContent}>
              <Text style={styles.safetyRuleTitle}>Fail applied for safety.</Text>
              <Text style={styles.safetyRuleBody}>
                FieldMesh merges conflicting pass/fail entries as <Text style={styles.failUnderline}>FAIL</Text> until an authorized lead confirms or overrides it here.
              </Text>
            </View>
          </View>
        )}

        <View style={styles.decisionSection}>
          <View style={styles.decisionHeader}>
            <Text style={styles.decisionLabel}>Human-in-the-loop verdict</Text>
            <Text style={styles.authRequired}>{mayReview ? `${user.role} sign-off` : 'Review required'}</Text>
          </View>

          {isFinalized ? (
            <View style={styles.gateNotice} testID="gate-finalized">
              <FieldMeshIcon name="lock" size={16} color={FieldMeshColors.outline} />
              <Text style={styles.gateNoticeText}>
                This inspection is finalized. An auditor must re-open it before any verdict can change.
              </Text>
            </View>
          ) : !mayReview ? (
            <View style={styles.gateNotice} testID="gate-role">
              <FieldMeshIcon name="lock" size={16} color={FieldMeshColors.outline} />
              <Text style={styles.gateNoticeText}>
                Settling a dispute can turn a safety FAIL into a PASS, so it is a supervisor or auditor
                decision. Your entries are recorded either way — ask a lead to sign this one off.
              </Text>
            </View>
          ) : null}

          {isPassFail ? (
            <>
              <Pressable onPress={handleConfirmFail} disabled={!canAct} style={({ pressed }) => [styles.confirmFailBtn, pressed && styles.btnPressed, !canAct && styles.btnDisabled]} testID="confirm-fail">
                {resolving ? <ActivityIndicator color="#fff" /> : <FieldMeshIcon name="verified" size={22} color={FieldMeshColors.onError} />}
                <Text style={styles.confirmFailBtnText}>Confirm FAIL as final result</Text>
              </Pressable>
              <Pressable onPress={() => setShowOverride(!showOverride)} style={({ pressed }) => [styles.changePassBtn, pressed && styles.btnPressed]} testID="show-override">
                <FieldMeshIcon name="swap_horiz" size={20} color={FieldMeshColors.secondary} />
                <Text style={styles.changePassBtnText}>Change to PASS with explanation</Text>
              </Pressable>
              {showOverride && (
                <View style={styles.overrideForm}>
                  <View style={styles.overrideLabelRow}>
                    <FieldMeshIcon name="edit_note" size={18} color={FieldMeshColors.error} />
                    <Text style={styles.overrideLabelText}>Mandatory safety override reason:</Text>
                  </View>
                  <TextInput
                    style={styles.overrideInput}
                    multiline
                    placeholder="e.g. Cleaned shed; surface dust was mistaken for carbon track. Dielectric tested OK at 22kV."
                    placeholderTextColor={FieldMeshColors.outline}
                    value={overrideNotes}
                    onChangeText={setOverrideNotes}
                    testID="override-notes"
                  />
                  <Pressable onPress={handleConfirmPass} disabled={!canAct} style={({ pressed }) => [styles.submitOverrideBtn, pressed && styles.btnPressed, !canAct && styles.btnDisabled]} testID="confirm-pass">
                    <FieldMeshIcon name="check_circle" size={20} color={FieldMeshColors.onSecondary} />
                    <Text style={styles.submitOverrideText}>Sign & confirm PASS override</Text>
                  </Pressable>
                </View>
              )}
            </>
          ) : (
            <View style={styles.overrideForm}>
              <Text style={styles.overrideLabelText}>Pick an entry above or enter the resolved value</Text>
              <TextInput
                style={styles.valueInput}
                keyboardType={isNumeric ? 'numeric' : 'default'}
                placeholder={isNumeric ? `Reading${field?.unit ? ` in ${field.unit}` : ''}` : 'Resolved value'}
                placeholderTextColor={FieldMeshColors.outline}
                value={chosen}
                onChangeText={setChosen}
                testID="resolved-value"
              />
              <TextInput
                style={styles.overrideInput}
                multiline
                placeholder="Optional note for the audit trail"
                placeholderTextColor={FieldMeshColors.outline}
                value={overrideNotes}
                onChangeText={setOverrideNotes}
              />
              <Pressable onPress={handleGenericResolve} disabled={!canAct} style={({ pressed }) => [styles.confirmGenericBtn, pressed && styles.btnPressed, !canAct && styles.btnDisabled]} testID="confirm-resolution">
                {resolving ? <ActivityIndicator color="#fff" /> : <FieldMeshIcon name="check_circle" size={20} color={FieldMeshColors.onPrimary} />}
                <Text style={styles.confirmGenericText}>{serverDisputed ? 'Sign & resolve on server' : 'Record resolution'}</Text>
              </Pressable>
            </View>
          )}

          <Text style={styles.footnote}>
            {serverDisputed
              ? 'POST /inspections/:id/resolve writes one edit naming every disputed head as its parent.'
              : 'The server has no open dispute for this field; the resolution is stored as a normal edit that supersedes the local heads.'}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FieldMeshColors.surface },
  scroll: { flex: 1 },
  content: { padding: FieldMeshSpacing.gutter, gap: FieldMeshSpacing.md },
  contextBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -4 },
  backLinkText: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.primary },
  relayBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: FieldMeshColors.surfaceContainerHigh, paddingHorizontal: 10, paddingVertical: 4, borderRadius: FieldMeshRadius.full },
  relayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: FieldMeshColors.secondary },
  relayText: { fontFamily: 'monospace', fontSize: 11, fontWeight: '600', color: FieldMeshColors.onSurfaceVariant },
  itemHeader: { gap: 4 },
  itemTagRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemTag: { backgroundColor: FieldMeshColors.surfaceContainerHighest, paddingHorizontal: 8, paddingVertical: 3, borderRadius: FieldMeshRadius.xs, fontFamily: 'monospace', fontSize: 11, fontWeight: '600', color: FieldMeshColors.onSurfaceVariant, flexShrink: 1 },
  itemTitle: { fontSize: 20, fontWeight: '700', color: FieldMeshColors.onSurface },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { fontSize: 13, color: FieldMeshColors.onSurfaceVariant },
  infoBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: FieldMeshColors.surfaceContainerHigh, padding: 10, borderRadius: FieldMeshRadius.md },
  infoBannerText: { flex: 1, fontSize: 12, fontWeight: '600', color: FieldMeshColors.onSurfaceVariant },
  conflictCard: { backgroundColor: FieldMeshColors.tertiaryFixed, borderRadius: FieldMeshRadius.lg, padding: FieldMeshSpacing.md, gap: 12 },
  conflictHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 182, 142, 0.4)', paddingBottom: 8 },
  warningIconCircle: { width: 32, height: 32, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.tertiaryContainer, alignItems: 'center', justifyContent: 'center' },
  conflictHeaderText: { flex: 1 },
  conflictTitle: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onTertiaryFixed },
  conflictSubtitle: { fontSize: 12, color: FieldMeshColors.onTertiaryFixedVariant, marginTop: 1 },
  splitGrid: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  recordBox: { flex: 1, minWidth: 140, backgroundColor: FieldMeshColors.surfaceLowest, borderRadius: FieldMeshRadius.md, padding: 10, justifyContent: 'space-between', gap: 8, borderWidth: 1.5, borderColor: 'transparent' },
  recordBoxAlert: { borderColor: 'rgba(186, 26, 26, 0.3)' },
  recordBoxSelected: { borderColor: FieldMeshColors.primary },
  peerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  peerAvatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: FieldMeshColors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  avatarAlert: { backgroundColor: FieldMeshColors.errorContainer },
  peerInitial: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', color: FieldMeshColors.onSurface },
  textAlert: { color: FieldMeshColors.error },
  peerInfo: { flex: 1 },
  peerName: { fontSize: 12, fontWeight: '700', color: FieldMeshColors.onSurface },
  peerDevice: { fontSize: 10, color: FieldMeshColors.onSurfaceVariant },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeText: { fontFamily: 'monospace', fontSize: 11, color: FieldMeshColors.onSurfaceVariant },
  verdictDisplayPass: { backgroundColor: FieldMeshColors.surfaceContainerLow, padding: 8, borderRadius: FieldMeshRadius.xs, alignItems: 'center', gap: 4 },
  passText: { fontSize: 13, fontWeight: '800', color: FieldMeshColors.onSurface, textAlign: 'center' },
  verdictDisplayFail: { backgroundColor: FieldMeshColors.errorContainer, padding: 8, borderRadius: FieldMeshRadius.xs, alignItems: 'center', gap: 4 },
  failText: { fontSize: 13, fontWeight: '800', color: FieldMeshColors.onError, backgroundColor: FieldMeshColors.error, paddingHorizontal: 8, paddingVertical: 2, borderRadius: FieldMeshRadius.xs, textTransform: 'uppercase' },
  safetyRuleBanner: { backgroundColor: FieldMeshColors.inverseSurface, padding: 14, borderRadius: FieldMeshRadius.lg, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  safetyIconContainer: { width: 28, height: 28, borderRadius: FieldMeshRadius.sm, backgroundColor: FieldMeshColors.error, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  safetyRuleContent: { flex: 1, gap: 4 },
  safetyRuleTitle: { fontSize: 14, fontWeight: '700', color: FieldMeshColors.inverseOnSurface },
  safetyRuleBody: { fontSize: 12, color: FieldMeshColors.surfaceContainerHighest, lineHeight: 18 },
  failUnderline: { color: FieldMeshColors.errorContainer, fontWeight: '700', textDecorationLine: 'underline' },
  decisionSection: { gap: 10 },
  decisionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 },
  decisionLabel: { fontSize: 11, fontWeight: '700', color: FieldMeshColors.outline, textTransform: 'uppercase', letterSpacing: 0.5 },
  authRequired: { fontFamily: 'monospace', fontSize: 11, color: FieldMeshColors.onSurfaceVariant },
  confirmFailBtn: { height: 56, borderRadius: FieldMeshRadius.lg, backgroundColor: FieldMeshColors.error, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: FieldMeshColors.error, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4 },
  confirmFailBtnText: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onError },
  changePassBtn: { height: 52, borderRadius: FieldMeshRadius.lg, backgroundColor: FieldMeshColors.surfaceContainerHigh, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  changePassBtnText: { fontSize: 14, fontWeight: '700', color: FieldMeshColors.onSurface },
  overrideForm: { backgroundColor: FieldMeshColors.surfaceContainer, padding: 12, borderRadius: FieldMeshRadius.lg, gap: 10, marginTop: 4 },
  overrideLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  overrideLabelText: { fontSize: 12, fontWeight: '700', color: FieldMeshColors.onSurface },
  overrideInput: { backgroundColor: FieldMeshColors.surfaceLowest, borderRadius: FieldMeshRadius.md, padding: 10, fontSize: 13, color: FieldMeshColors.onSurface, textAlignVertical: 'top', minHeight: 60 },
  valueInput: { backgroundColor: FieldMeshColors.surfaceLowest, borderRadius: FieldMeshRadius.md, padding: 10, fontSize: 16, fontWeight: '700', fontFamily: 'monospace', color: FieldMeshColors.onSurface, height: 48 },
  submitOverrideBtn: { height: 50, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.secondary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitOverrideText: { fontSize: 14, fontWeight: '700', color: FieldMeshColors.onSecondary },
  confirmGenericBtn: { height: 52, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  confirmGenericText: { fontSize: 14, fontWeight: '700', color: FieldMeshColors.onPrimary },
  footnote: { fontFamily: 'monospace', fontSize: 10, color: FieldMeshColors.outline, lineHeight: 14 },
  btnPressed: { opacity: 0.88, transform: [{ scale: 0.985 }] },
  btnDisabled: { opacity: 0.4 },
  gateNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: FieldMeshSpacing.sm,
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    borderRadius: FieldMeshRadius.md,
    padding: FieldMeshSpacing.md,
    marginBottom: FieldMeshSpacing.md,
  },
  gateNoticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: FieldMeshColors.onSurfaceVariant,
  },
});
