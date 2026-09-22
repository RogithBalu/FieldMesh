import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { useAuth } from '@/lib/auth-context';
import * as db from '@/lib/localdb';

export default function TeamsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [teams, setTeams] = useState<db.Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTeamName, setNewTeamName] = useState('');
  const [creating, setCreating] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [memberEmail, setMemberEmail] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [addMemberError, setAddMemberError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setTeams(await db.listTeamsFor(user.id));
    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleCreate = async () => {
    if (!user || !newTeamName.trim()) return;
    setCreating(true);
    try {
      await db.createTeam(newTeamName.trim(), user.id);
      setNewTeamName('');
      await load();
    } finally {
      setCreating(false);
    }
  };

  const handleAddMember = async (teamId: string) => {
    if (!user || !memberEmail.trim()) return;
    setAddingMember(true);
    setAddMemberError(null);
    try {
      await db.addTeamMember(teamId, user.id, memberEmail.trim());
      setMemberEmail('');
      setExpandedTeamId(null);
      await load();
    } catch (e) {
      setAddMemberError(e instanceof db.LocalDbError ? e.message : 'Could not add member.');
    } finally {
      setAddingMember(false);
    }
  };

  return (
    <View style={styles.container}>
      <FieldMeshHeader title="Teams" category="FIELDMESH" showBack onBackPress={() => router.back()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.createCard}>
          <Text style={styles.createLabel}>Create a team</Text>
          <View style={styles.createRow}>
            <TextInput
              style={styles.createInput}
              value={newTeamName}
              onChangeText={setNewTeamName}
              placeholder="e.g. North Grid Crew"
              placeholderTextColor={FieldMeshColors.outline}
            />
            <Pressable
              onPress={handleCreate}
              disabled={creating || !newTeamName.trim()}
              style={({ pressed }) => [
                styles.createBtn,
                (creating || !newTeamName.trim()) && styles.createBtnDisabled,
                pressed && styles.pressed,
              ]}
            >
              {creating ? <ActivityIndicator color="#fff" size="small" /> : <FieldMeshIcon name="add" size={20} color="#fff" />}
            </Pressable>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={FieldMeshColors.primary} />
        ) : teams.length === 0 ? (
          <View style={styles.emptyState}>
            <FieldMeshIcon name="hub" size={32} color={FieldMeshColors.outline} />
            <Text style={styles.emptyTitle}>No teams yet</Text>
            <Text style={styles.emptyBody}>Create one above — you'll need a team before you can start an inspection.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {teams.map((team) => (
              <View key={team.id} style={styles.teamCard}>
                <Pressable
                  style={styles.teamRow}
                  onPress={() => {
                    setExpandedTeamId(expandedTeamId === team.id ? null : team.id);
                    setAddMemberError(null);
                  }}
                >
                  <View style={styles.teamIconCircle}>
                    <FieldMeshIcon name="hub" size={18} color={FieldMeshColors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.teamName}>{team.name}</Text>
                    <Text style={styles.teamMeta}>
                      {team.memberIds.length} member{team.memberIds.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <FieldMeshIcon
                    name={expandedTeamId === team.id ? 'expand-less' : 'chevron_right'}
                    size={22}
                    color={FieldMeshColors.onSurfaceVariant}
                  />
                </Pressable>

                {expandedTeamId === team.id && (
                  <View style={styles.expandedArea}>
                    <Text style={styles.addMemberLabel}>Add a member by email</Text>
                    <Text style={styles.addMemberHint}>They must already have a FieldMesh account on this device.</Text>
                    <View style={styles.createRow}>
                      <TextInput
                        style={styles.createInput}
                        value={memberEmail}
                        onChangeText={setMemberEmail}
                        placeholder="teammate@fieldmesh.io"
                        placeholderTextColor={FieldMeshColors.outline}
                        autoCapitalize="none"
                        keyboardType="email-address"
                      />
                      <Pressable
                        onPress={() => handleAddMember(team.id)}
                        disabled={addingMember || !memberEmail.trim()}
                        style={({ pressed }) => [
                          styles.createBtn,
                          (addingMember || !memberEmail.trim()) && styles.createBtnDisabled,
                          pressed && styles.pressed,
                        ]}
                      >
                        {addingMember ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <FieldMeshIcon name="add" size={20} color="#fff" />
                        )}
                      </Pressable>
                    </View>
                    {addMemberError && <Text style={styles.errorText}>{addMemberError}</Text>}
                  </View>
                )}
              </View>
            ))}
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
  createCard: {
    backgroundColor: FieldMeshColors.surfaceLowest, padding: FieldMeshSpacing.md, borderRadius: FieldMeshRadius.lg,
    borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh, gap: 8,
  },
  createLabel: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.onSurface },
  createRow: { flexDirection: 'row', gap: 8 },
  createInput: {
    flex: 1, height: 46, borderRadius: FieldMeshRadius.md, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh,
    paddingHorizontal: 12, fontSize: 14, color: FieldMeshColors.onSurface, backgroundColor: FieldMeshColors.surfaceContainerLow,
  },
  createBtn: {
    width: 46, height: 46, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  createBtnDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  emptyState: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onSurface },
  emptyBody: { fontSize: 13, color: FieldMeshColors.onSurfaceVariant, textAlign: 'center', lineHeight: 18 },
  list: { gap: FieldMeshSpacing.md },
  teamCard: {
    backgroundColor: FieldMeshColors.surfaceLowest, borderRadius: FieldMeshRadius.lg,
    borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh, overflow: 'hidden',
  },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: FieldMeshSpacing.md },
  teamIconCircle: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: FieldMeshColors.primaryFixed,
    alignItems: 'center', justifyContent: 'center',
  },
  teamName: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onSurface },
  teamMeta: { fontSize: 12, color: FieldMeshColors.onSurfaceVariant, marginTop: 1 },
  expandedArea: {
    padding: FieldMeshSpacing.md, paddingTop: 0, gap: 6,
    borderTopWidth: 1, borderTopColor: FieldMeshColors.surfaceContainerLow, marginTop: 2,
  },
  addMemberLabel: { fontSize: 12, fontWeight: '700', color: FieldMeshColors.onSurface, marginTop: 10 },
  addMemberHint: { fontSize: 11, color: FieldMeshColors.onSurfaceVariant, marginBottom: 4 },
  errorText: { fontSize: 12, fontWeight: '600', color: FieldMeshColors.error },
});
