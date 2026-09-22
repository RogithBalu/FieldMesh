import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { useAuth } from '@/lib/auth-context';
import * as db from '@/lib/localdb';

export default function NewInspectionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [teams, setTeams] = useState<db.Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [site, setSite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    db.listTeamsFor(user.id).then((t) => {
      setTeams(t);
      if (t.length === 1) setTeamId(t[0].id);
    });
  }, [user]);

  const handleCreate = async () => {
    if (!user) return;
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
    try {
      const inspection = await db.createInspection({ teamId, title, site, createdBy: user.id });
      router.replace(`/(fieldmesh)/inspections/${inspection.id}`);
    } catch (e) {
      setError(e instanceof db.LocalDbError ? e.message : 'Could not create inspection.');
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
      >
        {teams.length === 0 ? (
          <View style={styles.emptyState}>
            <FieldMeshIcon name="hub" size={32} color={FieldMeshColors.outline} />
            <Text style={styles.emptyTitle}>You need a team first</Text>
            <Pressable
              onPress={() => router.replace('/(fieldmesh)/teams')}
              style={({ pressed }) => [styles.createBtn, pressed && styles.pressed]}
            >
              <Text style={styles.createBtnText}>Create a team</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Team</Text>
              <View style={styles.teamRow}>
                {teams.map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => setTeamId(t.id)}
                    style={[styles.teamPill, teamId === t.id && styles.teamPillActive]}
                  >
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
              />
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable
              onPress={handleCreate}
              disabled={busy}
              style={({ pressed }) => [styles.createBtn, pressed && styles.pressed]}
            >
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
    height: 48, borderRadius: FieldMeshRadius.md, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh,
    paddingHorizontal: 14, fontSize: 14, color: FieldMeshColors.onSurface, backgroundColor: FieldMeshColors.surfaceLowest,
  },
  teamRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  teamPill: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: FieldMeshRadius.full,
    backgroundColor: FieldMeshColors.surfaceContainer, borderWidth: 1, borderColor: 'transparent',
  },
  teamPillActive: { backgroundColor: FieldMeshColors.primaryFixed, borderColor: FieldMeshColors.primary },
  teamPillText: { fontSize: 13, fontWeight: '600', color: FieldMeshColors.onSurfaceVariant },
  teamPillTextActive: { color: FieldMeshColors.onPrimaryFixed },
  errorText: { fontSize: 12.5, fontWeight: '600', color: FieldMeshColors.error },
  createBtn: {
    height: 52, backgroundColor: FieldMeshColors.primary, borderRadius: FieldMeshRadius.lg, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6,
  },
  createBtnText: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onPrimary },
  pressed: { opacity: 0.9 },
  emptyState: { alignItems: 'center', gap: 12, paddingVertical: 40 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onSurface },
});
