import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { CHECKLIST_TEMPLATE, templateFieldDefs } from '@/constants/checklistTemplate';
import { api, errorMessage, NetworkError, type Team } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { upsertCachedInspection } from '@/lib/inspectionsCache';
import { readCachedTeams } from '@/lib/teamsCache';
import { enqueueCreate, newLocalId, readPending } from '@/lib/pendingCreates';

/**
 * POST /inspections with the checklist's field definitions so the server's
 * dispute rules match the UI.
 *
 * Works with no server: the phone names the inspection, writes it to the local
 * list and opens its checklist straight away, and the create waits in the
 * pending queue. The team picker falls back to the cached teams for the same
 * reason — including teams that are themselves still queued.
 */
export default function NewInspectionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [site, setSite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pick = (list: Team[]) => {
      if (cancelled) return;
      setTeams(list);
      if (list.length === 1) setTeamId(list[0].id);
    };
    api
      .listTeams()
      .then(pick)
      .catch(async (e) => {
        const cached = (await readCachedTeams()) ?? [];
        const queued = (await readPending())
          .filter((p): p is Extract<typeof p, { kind: 'team' }> => p.kind === 'team')
          .map((p) => ({ id: p.id, name: p.name }));
        const merged = [...queued.filter((q) => !cached.some((c) => c.id === q.id)), ...cached];
        pick(merged);
        if (!cancelled && merged.length === 0) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreate = async () => {
    if (!teamId) {
      setError('Choose a team.');
      return;
    }
    if (!title.trim()) {
      setError('Give the inspection a title.');
      return;
    }
    setBusy(true);
    setError(null);

    const id = newLocalId();
    const trimmedTitle = title.trim();
    const trimmedSite = site.trim() || null;
    // Written before and after either outcome: the local record is what makes
    // the checklist openable, online or not.
    const cacheIt = (realId: string = id) =>
      upsertCachedInspection(
        {
          id: realId,
          team_id: teamId,
          title: trimmedTitle,
          site: trimmedSite,
          created_by: user?.id ?? '',
          created_at: Date.now(),
          schema_version: 1,
          teamName: teams?.find((t) => t.id === teamId)?.name,
        },
        { total: CHECKLIST_TEMPLATE.length }
      );

    try {
      // An older server ignores our id and mints its own; follow its answer so
      // the cached row and the Yjs document key match what the server holds.
      const created = await api.createInspection({
        id,
        teamId,
        title: trimmedTitle,
        site: trimmedSite ?? undefined,
        schemaVersion: 1,
        fields: templateFieldDefs(),
      });
      await cacheIt(created.id);
      router.replace(`/(fieldmesh)/inspections/${created.id}`);
    } catch (e) {
      if (e instanceof NetworkError) {
        await enqueueCreate({
          kind: 'inspection',
          id,
          teamId,
          title: trimmedTitle,
          site: trimmedSite ?? undefined,
          schemaVersion: 1,
          fields: templateFieldDefs(),
          queuedAt: Date.now(),
        });
        await cacheIt();
        router.replace(`/(fieldmesh)/inspections/${id}`);
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <FieldMeshHeader title="New Inspection" category="CREATE" showBack onBackPress={() => router.back()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {teams === null ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={FieldMeshColors.primary} />
        ) : teams.length === 0 ? (
          <View style={styles.emptyState}>
            <FieldMeshIcon name="hub" size={32} color={FieldMeshColors.outline} />
            <Text style={styles.emptyTitle}>You need a team first</Text>
            <Text style={styles.emptyBody}>Inspections belong to a team so teammates can sync and review them.</Text>
            {error && <Text style={styles.errorText}>{error}</Text>}
            <Pressable onPress={() => router.replace('/(fieldmesh)/teams')} style={({ pressed }) => [styles.createBtn, pressed && styles.pressed]}>
              <Text style={styles.createBtnText}>Create a team</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Team</Text>
              <View style={styles.teamRow}>
                {teams.map((t) => (
                  <Pressable key={t.id} onPress={() => setTeamId(t.id)} style={[styles.teamPill, teamId === t.id && styles.teamPillActive]}>
                    <Text style={[styles.teamPillText, teamId === t.id && styles.teamPillTextActive]}>{t.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Title</Text>
              <TextInput
                style={styles.textInput}
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Transformer Safety Inspection"
                placeholderTextColor={FieldMeshColors.outline}
                testID="inspection-title"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Site (optional)</Text>
              <TextInput
                style={styles.textInput}
                value={site}
                onChangeText={setSite}
                placeholder="e.g. North Grid Substation — Bay 2"
                placeholderTextColor={FieldMeshColors.outline}
                testID="inspection-site"
              />
            </View>

            <View style={styles.templateCard}>
              <Text style={styles.templateLabel}>CHECKLIST · {CHECKLIST_TEMPLATE.length} ITEMS</Text>
              {CHECKLIST_TEMPLATE.map((f) => (
                <View key={f.fieldId} style={styles.templateRow}>
                  <Text style={styles.templateCode}>{f.code}</Text>
                  <Text style={styles.templateTitle} numberOfLines={1}>
                    {f.title}
                  </Text>
                  <Text style={styles.templateType}>{f.type.replace('_', '/')}</Text>
                </View>
              ))}
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable onPress={handleCreate} disabled={busy} testID="inspection-create" style={({ pressed }) => [styles.createBtn, pressed && styles.pressed]}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <FieldMeshIcon name="add" size={20} color={FieldMeshColors.onPrimary} />
                  <Text style={styles.createBtnText}>Create Inspection</Text>
                </>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FieldMeshColors.surface },
  scroll: { flex: 1 },
  content: { padding: FieldMeshSpacing.gutter, gap: FieldMeshSpacing.md },
  fieldGroup: { gap: 8 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.onSurface },
  textInput: {
    height: 48,
    borderRadius: FieldMeshRadius.md,
    borderWidth: 1,
    borderColor: FieldMeshColors.surfaceContainerHigh,
    paddingHorizontal: 14,
    fontSize: 14,
    color: FieldMeshColors.onSurface,
    backgroundColor: FieldMeshColors.surfaceLowest,
  },
  teamRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  teamPill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: FieldMeshRadius.full, backgroundColor: FieldMeshColors.surfaceContainer, borderWidth: 1, borderColor: 'transparent' },
  teamPillActive: { backgroundColor: FieldMeshColors.primaryFixed, borderColor: FieldMeshColors.primary },
  teamPillText: { fontSize: 13, fontWeight: '600', color: FieldMeshColors.onSurfaceVariant },
  teamPillTextActive: { color: FieldMeshColors.onPrimaryFixed },
  templateCard: { backgroundColor: FieldMeshColors.surfaceContainerLow, borderRadius: FieldMeshRadius.lg, padding: 12, gap: 6 },
  templateLabel: { fontSize: 10, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant, letterSpacing: 1, marginBottom: 2 },
  templateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  templateCode: { fontFamily: 'monospace', fontSize: 10, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant, width: 62 },
  templateTitle: { flex: 1, fontSize: 12.5, fontWeight: '600', color: FieldMeshColors.onSurface },
  templateType: { fontFamily: 'monospace', fontSize: 10, color: FieldMeshColors.outline },
  errorText: { fontSize: 12.5, fontWeight: '600', color: FieldMeshColors.error },
  createBtn: { height: 52, backgroundColor: FieldMeshColors.primary, borderRadius: FieldMeshRadius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6, paddingHorizontal: 20 },
  createBtnText: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onPrimary },
  pressed: { opacity: 0.9 },
  emptyState: { alignItems: 'center', gap: 12, paddingVertical: 40, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onSurface },
  emptyBody: { fontSize: 13, color: FieldMeshColors.onSurfaceVariant, textAlign: 'center', lineHeight: 18 },
});
