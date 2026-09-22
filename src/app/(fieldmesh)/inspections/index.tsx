import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { InspectionCard } from '@/components/fieldmesh/InspectionCard';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { CHECKLIST_TEMPLATE } from '@/constants/checklistTemplate';
import { readCachedList, writeCachedList, type CachedRow } from '@/lib/inspectionsCache';
import { useAuth } from '@/lib/auth-context';
import { api, errorMessage, NetworkError } from '@/lib/api';
import { isHiddenField, relativeTime } from '@/lib/checklist';
import { nameFor } from '@/lib/names';

type Row = CachedRow;

/**
 * Inspections list: GET /inspections + GET /teams (names) + GET /inspections/:id/report
 * per row for progress and dispute counts. The last good result is cached so
 * the list still opens offline.
 */
export default function InspectionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout, online } = useAuth();
  const [activeTab, setActiveTab] = useState<'all' | 'disputes'>('all');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hasTeams, setHasTeams] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [teams, inspections] = await Promise.all([api.listTeams(), api.listInspections()]);
      setHasTeams(teams.length > 0);
      const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
      const withSummaries: Row[] = await Promise.all(
        inspections.map(async (i) => {
          const base: Row = {
            ...i,
            teamName: teamNameById.get(i.team_id) ?? 'Unknown team',
            completed: 0,
            total: CHECKLIST_TEMPLATE.length,
            disputedCount: 0,
            lastEditedAt: i.created_at,
            lastEditedBy: null,
          };
          try {
            const r = await api.report(i.id);
            const visible = Object.entries(r.fields).filter(([k]) => !isHiddenField(k));
            const completed = visible.filter(([, f]) => f.value !== null).length;
            const latest = visible.reduce((best, [, f]) => (f.lastEditedAt > (best?.lastEditedAt ?? 0) ? f : best), null as null | (typeof visible)[number][1]);
            return {
              ...base,
              completed,
              total: Math.max(CHECKLIST_TEMPLATE.length, visible.length),
              disputedCount: r.summary.disputedFields,
              lastEditedAt: latest?.lastEditedAt ?? i.created_at,
              lastEditedBy: latest?.lastEditedBy ?? null,
            };
          } catch {
            return base;
          }
        })
      );
      withSummaries.sort((a, b) => b.lastEditedAt - a.lastEditedAt);
      setRows(withSummaries);
      setError(null);
      writeCachedList({ rows: withSummaries, hasTeams: teams.length > 0 });
    } catch (e) {
      const cached = await readCachedList();
      if (cached) {
        setRows(cached.rows);
        setHasTeams(cached.hasTeams);
      } else {
        setRows([]);
      }
      setError(e instanceof NetworkError ? 'Offline — showing the last list saved on this phone.' : errorMessage(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // While the server is unreachable, keep trying in the background so the list
  // flips back to live data as soon as the link returns.
  useEffect(() => {
    if (!error) return;
    const t = setInterval(() => {
      load();
    }, 15000);
    return () => clearInterval(t);
  }, [error, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = (rows ?? []).filter((r) => (activeTab === 'disputes' ? r.disputedCount > 0 : true));
  const disputeCount = (rows ?? []).filter((r) => r.disputedCount > 0).length;

  return (
    <View style={styles.container}>
      <FieldMeshHeader
        title="Inspections"
        category="FIELDMESH"
        statusBadge={
          online === false
            ? { label: 'Offline', variant: 'offline' }
            : { label: user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Online', variant: 'connected' }
        }
        rightAction={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => router.push('/(fieldmesh)/teams')} style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]} testID="open-teams">
              <FieldMeshIcon name="groups" size={18} color={FieldMeshColors.primary} />
            </Pressable>
            <Pressable onPress={() => router.push('/(fieldmesh)/mesh')} style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]} testID="open-mesh">
              <FieldMeshIcon name="sensors" size={18} color={FieldMeshColors.primary} />
            </Pressable>
            <Pressable
              onPress={async () => {
                await logout();
                router.replace('/(fieldmesh)/login');
              }}
              style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
              testID="logout"
            >
              <FieldMeshIcon name="logout" size={18} color={FieldMeshColors.onSurfaceVariant} />
            </Pressable>
          </View>
        }
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.statusBar}>
          <View style={styles.offlinePill}>
            <View style={[styles.offlineDot, online !== false && styles.onlineDot]} />
            <Text style={styles.offlineText}>{online === false ? 'SAVED ON PHONE' : 'SYNCED WITH SERVER'}</Text>
          </View>
          <Text style={styles.userText} numberOfLines={1}>
            {user?.name}
          </Text>
        </View>

        {error && (
          <View style={styles.noticeCard}>
            <View style={styles.noticeContent}>
              <FieldMeshIcon name="cloud_off" size={20} color={FieldMeshColors.onSurfaceVariant} />
              <Text style={styles.noticeText}>{error}</Text>
            </View>
            <Pressable onPress={load} style={({ pressed }) => [styles.learnMoreBtn, pressed && styles.buttonPressed]}>
              <Text style={styles.learnMoreText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {!hasTeams && rows !== null && !error && (
          <View style={styles.noticeCard}>
            <View style={styles.noticeContent}>
              <FieldMeshIcon name="info" size={20} color={FieldMeshColors.primaryContainer} />
              <Text style={styles.noticeText}>Create or join a team before starting your first inspection.</Text>
            </View>
            <Pressable onPress={() => router.push('/(fieldmesh)/teams')} style={({ pressed }) => [styles.learnMoreBtn, pressed && styles.buttonPressed]}>
              <Text style={styles.learnMoreText}>Teams</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.tabBar}>
          <Pressable onPress={() => setActiveTab('all')} style={[styles.tab, activeTab === 'all' ? styles.tabActive : styles.tabInactive]}>
            <Text style={[styles.tabText, activeTab === 'all' ? styles.tabTextActive : styles.tabTextInactive]}>All inspections</Text>
            <View style={[styles.countBadge, activeTab === 'all' ? styles.countBadgeActive : styles.countBadgeInactive]}>
              <Text style={[styles.countText, activeTab === 'all' ? styles.countTextActive : styles.countTextInactive]}>{rows?.length ?? 0}</Text>
            </View>
          </Pressable>
          <Pressable onPress={() => setActiveTab('disputes')} style={[styles.tab, activeTab === 'disputes' ? styles.tabActiveDispute : styles.tabInactive]}>
            <Text style={[styles.tabText, activeTab === 'disputes' ? styles.tabTextDispute : styles.tabTextInactive]}>Open disputes</Text>
            <View style={styles.disputeCountBadge}>
              <Text style={styles.disputeCountText}>{disputeCount}</Text>
            </View>
          </Pressable>
        </View>

        {rows === null ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={FieldMeshColors.primary} />
        ) : filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <FieldMeshIcon name="rule" size={32} color={FieldMeshColors.outline} />
            <Text style={styles.emptyTitle}>{activeTab === 'disputes' ? 'No open disputes' : 'No inspections yet'}</Text>
            {activeTab === 'all' && hasTeams && <Text style={styles.emptyBody}>Tap “New inspection” to start a checklist for your team.</Text>}
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((item) => {
              const statusType = item.disputedCount > 0 ? 'dispute' : item.completed >= item.total ? 'ready' : 'pending';
              const statusLabel =
                statusType === 'dispute'
                  ? `${item.disputedCount} dispute${item.disputedCount === 1 ? '' : 's'}`
                  : statusType === 'ready'
                    ? 'Complete'
                    : item.completed === 0
                      ? 'Not started'
                      : 'In progress';
              const who = item.lastEditedBy ? nameFor(item.lastEditedBy, user && item.lastEditedBy === user.id ? user.name : undefined) : null;
              return (
                <InspectionCard
                  key={item.id}
                  code={`#${item.id.slice(-6).toUpperCase()}`}
                  title={item.title}
                  location={item.site ?? item.teamName}
                  completed={item.completed}
                  total={item.total}
                  statusType={statusType}
                  statusLabel={statusLabel}
                  updatedInfo={`${who ? 'Updated' : 'Created'} ${relativeTime(item.lastEditedAt)}${who ? ` · ${who}` : ''}`}
                  tag={item.teamName}
                  onPress={() => router.push(`/(fieldmesh)/inspections/${item.id}`)}
                />
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottomDock, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Pressable onPress={() => router.push('/(fieldmesh)/inspections/new')} style={({ pressed }) => [styles.newInspectionBtn, pressed && styles.buttonPressed]} testID="new-inspection">
          <FieldMeshIcon name="add" size={22} color={FieldMeshColors.onPrimary} />
          <Text style={styles.newInspectionText}>New inspection</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FieldMeshColors.surface },
  scroll: { flex: 1 },
  content: { padding: FieldMeshSpacing.gutter, gap: FieldMeshSpacing.md },
  statusBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2, gap: 8 },
  offlinePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: FieldMeshColors.surfaceContainerHigh, paddingHorizontal: 12, paddingVertical: 5, borderRadius: FieldMeshRadius.full },
  offlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: FieldMeshColors.outline },
  onlineDot: { backgroundColor: FieldMeshColors.secondary },
  offlineText: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant, letterSpacing: 0.5 },
  userText: { fontFamily: 'monospace', fontSize: 12, fontWeight: '600', color: FieldMeshColors.onSurfaceVariant, flexShrink: 1 },
  noticeCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: FieldMeshColors.surfaceContainerLow, padding: 12, borderRadius: FieldMeshRadius.lg, gap: 12 },
  noticeContent: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  noticeText: { fontSize: 13, color: FieldMeshColors.onSurface, fontWeight: '500', flex: 1 },
  learnMoreBtn: { backgroundColor: FieldMeshColors.surfaceContainerHighest, paddingHorizontal: 10, paddingVertical: 6, borderRadius: FieldMeshRadius.md },
  learnMoreText: { fontSize: 12, fontWeight: '700', color: FieldMeshColors.onSurface },
  tabBar: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  tab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: FieldMeshRadius.full, gap: 6 },
  tabActive: { backgroundColor: FieldMeshColors.primary },
  tabActiveDispute: { backgroundColor: FieldMeshColors.tertiaryFixed },
  tabInactive: { backgroundColor: FieldMeshColors.surfaceContainer },
  tabText: { fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: FieldMeshColors.onPrimary },
  tabTextDispute: { color: FieldMeshColors.onTertiaryFixed },
  tabTextInactive: { color: FieldMeshColors.onSurfaceVariant },
  countBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: FieldMeshRadius.full },
  countBadgeActive: { backgroundColor: FieldMeshColors.primaryContainer },
  countBadgeInactive: { backgroundColor: FieldMeshColors.surfaceContainerHigh },
  countText: { fontSize: 11, fontWeight: '700' },
  countTextActive: { color: FieldMeshColors.onPrimaryContainer },
  countTextInactive: { color: FieldMeshColors.onSurfaceVariant },
  disputeCountBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: FieldMeshColors.tertiaryFixedDim, alignItems: 'center', justifyContent: 'center' },
  disputeCountText: { fontSize: 11, fontWeight: '700', color: FieldMeshColors.onTertiaryFixed },
  emptyState: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant },
  emptyBody: { fontSize: 12, color: FieldMeshColors.outline, textAlign: 'center' },
  list: { gap: FieldMeshSpacing.md },
  bottomDock: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: FieldMeshColors.surface, paddingHorizontal: FieldMeshSpacing.gutter, paddingTop: 10, borderTopWidth: 1, borderTopColor: FieldMeshColors.surfaceContainerHigh },
  newInspectionBtn: { height: 52, backgroundColor: FieldMeshColors.primaryContainer, borderRadius: FieldMeshRadius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: FieldMeshColors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 4 },
  newInspectionText: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onPrimary, letterSpacing: 0.3 },
  headerBtn: { width: 34, height: 34, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  headerBtnPressed: { opacity: 0.7 },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
