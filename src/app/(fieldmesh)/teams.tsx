import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { useAuth } from '@/lib/auth-context';
import { api, errorMessage, NetworkError, onConnectivity } from '@/lib/api';
import { readCachedTeams, removeCachedTeam, upsertCachedTeam, writeCachedTeams, type CachedTeam } from '@/lib/teamsCache';
import { enqueueCreate, flushPendingCreates, newLocalId, readPending } from '@/lib/pendingCreates';

/**
 * Teams: GET /teams, POST /teams, POST|DELETE /teams/:id/members.
 * The server adds members by user id (there is no user lookup by email), so
 * each operator's id is shown here with a copy button to hand to a team lead.
 *
 * The list works offline from a cache, and a team created without a server is
 * held in the pending queue until one is reachable.
 */
export default function TeamsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [teams, setTeams] = useState<CachedTeam[] | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [addMemberMsg, setAddMemberMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * Server list when reachable, cache when not. Teams still in the pending
   * queue are folded in either way: the server has not heard of them yet, but
   * they exist on this phone and belong on the list.
   */
  const load = useCallback(async () => {
    const pendingTeams = (await readPending())
      .filter((p): p is Extract<typeof p, { kind: 'team' }> => p.kind === 'team')
      .map((p) => ({ id: p.id, name: p.name, pending: true }));
    try {
      const fromServer = await api.listTeams();
      const merged = [
        ...pendingTeams.filter((p) => !fromServer.some((t) => t.id === p.id)),
        ...fromServer,
      ];
      setTeams(merged);
      writeCachedTeams(merged).catch(() => {});
      setLoadError(null);
    } catch (e) {
      const cached = (await readCachedTeams()) ?? [];
      const merged = [
        ...pendingTeams.filter((p) => !cached.some((t) => t.id === p.id)),
        ...cached,
      ];
      setTeams(merged);
      setLoadError(
        e instanceof NetworkError
          ? 'Offline — showing the teams saved on this phone.'
          : errorMessage(e)
      );
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      flushPendingCreates()
        .catch(() => ({ sent: 0 }))
        .then(() => load());
    }, [load])
  );

  // A reconnect is the moment the queue can drain, so push then re-read.
  useEffect(
    () =>
      onConnectivity((online) => {
        if (!online) return;
        flushPendingCreates()
          .then((r) => {
            if (r.sent > 0) load();
          })
          .catch(() => {});
      }),
    [load]
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  /**
   * The phone names the team, so an offline create still produces a real team
   * it can work with; the queued request carries that same id, which makes a
   * replay a no-op rather than a duplicate.
   */
  const handleCreate = async () => {
    const name = newTeamName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    const id = newLocalId();
    try {
      await api.createTeam(name, id);
      await upsertCachedTeam({ id, name });
      setNewTeamName('');
      await load();
    } catch (e) {
      if (e instanceof NetworkError) {
        await enqueueCreate({ kind: 'team', id, name, queuedAt: Date.now() });
        await upsertCachedTeam({ id, name, pending: true });
        setNewTeamName('');
        await load();
        setCreateError(null);
      } else {
        setCreateError(errorMessage(e));
      }
    } finally {
      setCreating(false);
    }
  };

  const handleLeave = (team: CachedTeam) => {
    if (!user) return;
    Alert.alert(
      `Leave ${team.name}?`,
      'You will stop seeing this team’s inspections. Another member can add you back with your operator ID.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setLeavingId(team.id);
            try {
              await api.removeTeamMember(team.id, user.id);
              await removeCachedTeam(team.id);
              setExpandedTeamId(null);
              await load();
            } catch (e) {
              // The last member of a team that still holds inspections is
              // refused, so the work does not end up unreachable.
              Alert.alert('Could not leave', errorMessage(e));
            } finally {
              setLeavingId(null);
            }
          },
        },
      ]
    );
  };

  const handleAddMember = async (teamId: string) => {
    const id = memberId.trim();
    if (!id) return;
    setAddingMember(true);
    setAddMemberMsg(null);
    try {
      await api.addTeamMember(teamId, id);
      setMemberId('');
      setAddMemberMsg({ ok: true, text: 'Member added. They now see this team’s inspections.' });
    } catch (e) {
      setAddMemberMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setAddingMember(false);
    }
  };

  const copyMyId = async () => {
    if (!user) return;
    await Clipboard.setStringAsync(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View style={styles.container}>
      <FieldMeshHeader title="Teams" category="FIELDMESH" showBack onBackPress={() => router.back()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* My operator id */}
        <View style={styles.idCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.idLabel}>YOUR OPERATOR ID</Text>
            <Text style={styles.idValue} numberOfLines={1}>
              {user?.id ?? '—'}
            </Text>
            <Text style={styles.idHint}>Share this with a team lead so they can add you to their team.</Text>
          </View>
          <Pressable onPress={copyMyId} style={({ pressed }) => [styles.copyBtn, pressed && styles.pressed]} testID="copy-my-id">
            <FieldMeshIcon name={copied ? 'check' : 'content_copy'} size={18} color={FieldMeshColors.primary} />
          </Pressable>
        </View>

        <View style={styles.createCard}>
          <Text style={styles.createLabel}>Create a team</Text>
          <View style={styles.createRow}>
            <TextInput
              style={styles.createInput}
              value={newTeamName}
              onChangeText={setNewTeamName}
              placeholder="e.g. North Grid Crew"
              placeholderTextColor={FieldMeshColors.outline}
              onSubmitEditing={handleCreate}
              testID="team-name"
            />
            <Pressable
              onPress={handleCreate}
              disabled={creating || !newTeamName.trim()}
              testID="team-create"
              style={({ pressed }) => [styles.createBtn, (creating || !newTeamName.trim()) && styles.createBtnDisabled, pressed && styles.pressed]}
            >
              {creating ? <ActivityIndicator color="#fff" size="small" /> : <FieldMeshIcon name="add" size={20} color="#fff" />}
            </Pressable>
          </View>
          {createError && <Text style={styles.errorText}>{createError}</Text>}
        </View>

        {loadError && (
          <View style={styles.errorBanner}>
            <FieldMeshIcon name="warning" size={16} color={FieldMeshColors.error} />
            <Text style={styles.errorBannerText}>{loadError}</Text>
          </View>
        )}

        {teams === null ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={FieldMeshColors.primary} />
        ) : teams.length === 0 ? (
          <View style={styles.emptyState}>
            <FieldMeshIcon name="hub" size={32} color={FieldMeshColors.outline} />
            <Text style={styles.emptyTitle}>No teams yet</Text>
            <Text style={styles.emptyBody}>Create one above, or ask a team lead to add your operator ID.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {teams.map((team) => (
              <View key={team.id} style={styles.teamCard}>
                <Pressable
                  style={styles.teamRow}
                  onPress={() => {
                    setExpandedTeamId(expandedTeamId === team.id ? null : team.id);
                    setAddMemberMsg(null);
                  }}
                >
                  <View style={styles.teamIconCircle}>
                    <FieldMeshIcon name="hub" size={18} color={FieldMeshColors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.teamName}>{team.name}</Text>
                    <Text style={styles.teamMeta}>
                      #{team.id.slice(-6).toUpperCase()} ·{' '}
                      {team.pending ? 'saved on this phone' : 'tap to add a member'}
                    </Text>
                  </View>
                  <FieldMeshIcon name={expandedTeamId === team.id ? 'expand_less' : 'chevron_right'} size={22} color={FieldMeshColors.onSurfaceVariant} />
                </Pressable>

                {expandedTeamId === team.id && (
                  <View style={styles.expandedArea}>
                    {team.pending && (
                      <Text style={styles.pendingHint}>
                        This team has not reached the server yet. Members can be added once it syncs.
                      </Text>
                    )}
                    <Text style={styles.addMemberLabel}>Add a member by operator ID</Text>
                    <Text style={styles.addMemberHint}>They must already have a FieldMesh account on this server.</Text>
                    <View style={styles.createRow}>
                      <TextInput
                        style={styles.createInput}
                        value={memberId}
                        onChangeText={setMemberId}
                        placeholder="Operator ID"
                        placeholderTextColor={FieldMeshColors.outline}
                        autoCapitalize="none"
                        autoCorrect={false}
                        onSubmitEditing={() => handleAddMember(team.id)}
                        testID="member-id"
                      />
                      <Pressable
                        onPress={() => handleAddMember(team.id)}
                        disabled={addingMember || !memberId.trim()}
                        testID="member-add"
                        style={({ pressed }) => [styles.createBtn, (addingMember || !memberId.trim()) && styles.createBtnDisabled, pressed && styles.pressed]}
                      >
                        {addingMember ? <ActivityIndicator color="#fff" size="small" /> : <FieldMeshIcon name="person_add" size={20} color="#fff" />}
                      </Pressable>
                    </View>
                    {addMemberMsg && (
                      <Text style={addMemberMsg.ok ? styles.okText : styles.errorText}>{addMemberMsg.text}</Text>
                    )}

                    <Pressable
                      onPress={() => handleLeave(team)}
                      disabled={leavingId === team.id}
                      testID={`team-leave-${team.id}`}
                      style={({ pressed }) => [styles.leaveBtn, pressed && styles.pressed, leavingId === team.id && styles.createBtnDisabled]}
                    >
                      {leavingId === team.id ? (
                        <ActivityIndicator color={FieldMeshColors.error} size="small" />
                      ) : (
                        <FieldMeshIcon name="logout" size={18} color={FieldMeshColors.error} />
                      )}
                      <Text style={styles.leaveBtnText}>Leave this team</Text>
                    </Pressable>
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
  pendingHint: {
    fontSize: 12,
    lineHeight: 17,
    color: FieldMeshColors.onSurfaceVariant,
    marginBottom: FieldMeshSpacing.sm,
  },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: FieldMeshSpacing.md,
    paddingVertical: 12,
    borderRadius: FieldMeshRadius.md,
    borderWidth: 1,
    borderColor: FieldMeshColors.error,
  },
  leaveBtnText: { color: FieldMeshColors.error, fontSize: 14, fontWeight: '600' },
  container: { flex: 1, backgroundColor: FieldMeshColors.surface },
  scroll: { flex: 1 },
  content: { padding: FieldMeshSpacing.gutter, gap: FieldMeshSpacing.md },
  idCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: FieldMeshColors.primaryFixed,
    padding: FieldMeshSpacing.md,
    borderRadius: FieldMeshRadius.lg,
  },
  idLabel: { fontSize: 10, fontWeight: '700', color: FieldMeshColors.onPrimaryFixed, letterSpacing: 1 },
  idValue: { fontFamily: 'monospace', fontSize: 14, fontWeight: '700', color: FieldMeshColors.onPrimaryFixed, marginTop: 2 },
  idHint: { fontSize: 11, color: FieldMeshColors.onPrimaryFixed, opacity: 0.8, marginTop: 4 },
  copyBtn: { width: 40, height: 40, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceLowest, alignItems: 'center', justifyContent: 'center' },
  createCard: {
    backgroundColor: FieldMeshColors.surfaceLowest,
    padding: FieldMeshSpacing.md,
    borderRadius: FieldMeshRadius.lg,
    borderWidth: 1,
    borderColor: FieldMeshColors.surfaceContainerHigh,
    gap: 8,
  },
  createLabel: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.onSurface },
  createRow: { flexDirection: 'row', gap: 8 },
  createInput: {
    flex: 1,
    height: 46,
    borderRadius: FieldMeshRadius.md,
    borderWidth: 1,
    borderColor: FieldMeshColors.surfaceContainerHigh,
    paddingHorizontal: 12,
    fontSize: 14,
    color: FieldMeshColors.onSurface,
    backgroundColor: FieldMeshColors.surfaceContainerLow,
  },
  createBtn: { width: 46, height: 46, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.primary, alignItems: 'center', justifyContent: 'center' },
  createBtnDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: FieldMeshColors.errorContainer, padding: 10, borderRadius: FieldMeshRadius.md },
  errorBannerText: { flex: 1, fontSize: 12, fontWeight: '600', color: FieldMeshColors.onErrorContainer },
  emptyState: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onSurface },
  emptyBody: { fontSize: 13, color: FieldMeshColors.onSurfaceVariant, textAlign: 'center', lineHeight: 18 },
  list: { gap: FieldMeshSpacing.md },
  teamCard: { backgroundColor: FieldMeshColors.surfaceLowest, borderRadius: FieldMeshRadius.lg, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh, overflow: 'hidden' },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: FieldMeshSpacing.md },
  teamIconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: FieldMeshColors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  teamName: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onSurface },
  teamMeta: { fontSize: 12, color: FieldMeshColors.onSurfaceVariant, marginTop: 1 },
  expandedArea: { padding: FieldMeshSpacing.md, paddingTop: 0, gap: 6, borderTopWidth: 1, borderTopColor: FieldMeshColors.surfaceContainerLow, marginTop: 2 },
  addMemberLabel: { fontSize: 12, fontWeight: '700', color: FieldMeshColors.onSurface, marginTop: 10 },
  addMemberHint: { fontSize: 11, color: FieldMeshColors.onSurfaceVariant, marginBottom: 4 },
  errorText: { fontSize: 12, fontWeight: '600', color: FieldMeshColors.error },
  okText: { fontSize: 12, fontWeight: '600', color: FieldMeshColors.secondary },
});
