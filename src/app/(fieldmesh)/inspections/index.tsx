import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { InspectionCard } from '@/components/fieldmesh/InspectionCard';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { useAuth } from '@/lib/auth-context';
import * as db from '@/lib/localdb';
import { readInspectionSummary, InspectionSummary } from '@/lib/inspectionSummary';

interface Row extends db.Inspection {
  teamName: string;
  summary: InspectionSummary;
}

export default function InspectionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'all' | 'disputes'>('all');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hasTeams, setHasTeams] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    const [teams, inspections] = await Promise.all([db.listTeamsFor(user.id), db.listInspectionsFor(user.id)]);
    setHasTeams(teams.length > 0);
    const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
    const withSummaries = await Promise.all(
      inspections.map(async (i) => ({
        ...i,
        teamName: teamNameById.get(i.teamId) ?? 'Unknown team',
        summary: await readInspectionSummary(i.id),
      }))
    );
    setRows(withSummaries);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filtered = (rows ?? []).filter((r) => (activeTab === 'disputes' ? r.summary.disputedCount > 0 : true));
  const disputeCount = (rows ?? []).filter((r) => r.summary.disputedCount > 0).length;

  return (
    <View style={styles.container}>
      <FieldMeshHeader
        title="Inspections"
        category="FIELDMESH"
        statusBadge={{ label: user?.role ?? '', variant: 'connected' }}
        rightAction={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => router.push('/(fieldmesh)/teams')}
              style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
            >
              <FieldMeshIcon name="hub" size={18} color={FieldMeshColors.primary} />
            </Pressable>
            <Pressable
              onPress={logout}
              style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
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
      >
        <View style={styles.statusBar}>
          <View style={styles.offlinePill}>
            <View style={styles.offlineDot} />
            <Text style={styles.offlineText}>SAVED ON PHONE</Text>
          </View>
          <Text style={styles.userText}>{user?.name}</Text>
        </View>

        {!hasTeams && rows !== null && (
          <View style={styles.noticeCard}>
            <View style={styles.noticeContent}>
              <FieldMeshIcon name="info" size={20} color={FieldMeshColors.primaryContainer} />
              <Text style={styles.noticeText}>Create a team before starting your first inspection.</Text>
            </View>
            <Pressable
              onPress={() => router.push('/(fieldmesh)/teams')}
              style={({ pressed }) => [styles.learnMoreBtn, pressed && styles.buttonPressed]}
            >
              <Text style={styles.learnMoreText}>Create team</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.tabBar}>
          <Pressable
            onPress={() => setActiveTab('all')}
            style={[styles.tab, activeTab === 'all' ? styles.tabActive : styles.tabInactive]}
          >
            <Text style={[styles.tabText, activeTab === 'all' ? styles.tabTextActive : styles.tabTextInactive]}>
              All inspections
            </Text>
            <View style={[styles.countBadge, activeTab === 'all' ? styles.countBadgeActive : styles.countBadgeInactive]}>
              <Text style={[styles.countText, activeTab === 'all' ? styles.countTextActive : styles.countTextInactive]}>
                {rows?.length ?? 0}
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('disputes')}
            style={[styles.tab, activeTab === 'disputes' ? styles.tabActiveDispute : styles.tabInactive]}
          >
            <Text style={[styles.tabText, activeTab === 'disputes' ? styles.tabTextDispute : styles.tabTextInactive]}>
              Open disputes
            </Text>
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
            <Text style={styles.emptyTitle}>
              {activeTab === 'disputes' ? 'No open disputes' : 'No inspections yet'}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((item) => {
              const statusType = item.summary.disputedCount > 0 ? 'dispute' : item.summary.completed >= item.summary.total ? 'ready' : 'pending';
              const statusLabel =
                statusType === 'dispute'
                  ? `${item.summary.disputedCount} dispute${item.summary.disputedCount === 1 ? '' : 's'}`
                  : statusType === 'ready'
                  ? 'Ready to sync'
                  : 'In progress';
              return (
                <InspectionCard
                  key={item.id}
                  code={`#${item.id.slice(-6).toUpperCase()}`}
                  title={item.title}
                  location={[item.teamName, item.site].filter(Boolean).join(' · ')}
                  completed={item.summary.completed}
                  total={item.summary.total}
                  statusType={statusType}
                  statusLabel={statusLabel}
                  updatedInfo={new Date(item.createdAt).toLocaleDateString()}
                  tag={item.teamName}
                  onPress={() => router.push(`/(fieldmesh)/inspections/${item.id}`)}
                />
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottomDock, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Pressable
          onPress={() => router.push('/(fieldmesh)/inspections/new')}
          style={({ pressed }) => [styles.newInspectionBtn, pressed && styles.buttonPressed]}
        >
          <FieldMeshIcon name="add" size={22} color={FieldMeshColors.onPrimary} />
          <Text style={styles.newInspectionText}>+ New inspection</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FieldMeshColors.surface },
  scroll: { flex: 1 },
  content: { padding: FieldMeshSpacing.gutter, gap: FieldMeshSpacing.md },
  statusBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 },
  offlinePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: FieldMeshColors.surfaceContainerHigh,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: FieldMeshRadius.full,
  },
  offlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: FieldMeshColors.outline },
  offlineText: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant, letterSpacing: 0.5 },
  userText: { fontFamily: 'monospace', fontSize: 12, fontWeight: '600', color: FieldMeshColors.onSurfaceVariant },
  noticeCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: FieldMeshColors.surfaceContainerLow,
    padding: 12, borderRadius: FieldMeshRadius.lg, gap: 12,
  },
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
  emptyState: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant },
  list: { gap: FieldMeshSpacing.md },
  bottomDock: {
    position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: FieldMeshColors.surface,
    paddingHorizontal: FieldMeshSpacing.gutter, paddingTop: 10, borderTopWidth: 1, borderTopColor: FieldMeshColors.surfaceContainerHigh,
  },
  newInspectionBtn: {
    height: 52, backgroundColor: FieldMeshColors.primaryContainer, borderRadius: FieldMeshRadius.lg, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: FieldMeshColors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 4,
  },
  newInspectionText: { fontSize: 15, fontWeight: '700', color: FieldMeshColors.onPrimary, letterSpacing: 0.3 },
  headerBtn: {
    width: 34, height: 34, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainerHigh,
    alignItems: 'center', justifyContent: 'center',
  },
  headerBtnPressed: { opacity: 0.7 },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
