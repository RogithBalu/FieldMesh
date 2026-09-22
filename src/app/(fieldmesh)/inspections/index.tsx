import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { InspectionCard } from '@/components/fieldmesh/InspectionCard';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';

export default function InspectionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'all' | 'disputes'>('all');

  const inspectionsData = [
    {
      id: 'TR-4091',
      code: '#TR-4091',
      title: 'Transformer Safety Inspection',
      location: 'North Grid Substation — Bay 2',
      completed: 8,
      total: 12,
      statusType: 'dispute' as const,
      statusLabel: '1 dispute',
      updatedInfo: 'Updated 12m ago · Ravi',
      tag: 'Phase 2',
    },
    {
      id: 'SW-1104',
      code: '#SW-1104',
      title: 'High Voltage Switchgear Check',
      location: 'West Feeder Bay 4',
      completed: 12,
      total: 12,
      statusType: 'ready' as const,
      statusLabel: 'Ready to sync',
      updatedInfo: 'Completed 1h ago · Priya',
      tag: 'Signed off',
    },
    {
      id: 'GR-8890',
      code: '#GR-8890',
      title: 'Perimeter Earthing & Grounding',
      location: 'Primary Inverter Yard',
      completed: 0,
      total: 9,
      statusType: 'pending' as const,
      statusLabel: 'Pending',
      updatedInfo: 'Scheduled today',
      tag: 'Unassigned',
    },
  ];

  const filteredInspections =
    activeTab === 'disputes'
      ? inspectionsData.filter((item) => item.statusType === 'dispute')
      : inspectionsData;

  return (
    <View style={styles.container}>
      <FieldMeshHeader
        title="Inspections"
        category="FIELDMESH"
        statusBadge={{ label: 'On site · 4', variant: 'connected' }}
        rightAction={
          <Pressable
            onPress={() => router.push('/mesh')}
            style={({ pressed }) => [styles.meshButton, pressed && styles.meshButtonPressed]}
          >
            <FieldMeshIcon name="sensors" size={18} color={FieldMeshColors.primary} />
            <Text style={styles.meshButtonText}>Mesh</Text>
          </Pressable>
        }
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Device Status Bar */}
        <View style={styles.statusBar}>
          <View style={styles.offlinePill}>
            <View style={styles.offlineDot} />
            <Text style={styles.offlineText}>SAVED ON PHONE</Text>
          </View>
          <Text style={styles.siteIdText}>Site ID: #NG-884</Text>
        </View>

        {/* Notice Card */}
        <View style={styles.noticeCard}>
          <View style={styles.noticeContent}>
            <FieldMeshIcon name="info" size={20} color={FieldMeshColors.primaryContainer} />
            <Text style={styles.noticeText}>A teammate is using a newer app version.</Text>
          </View>
          <Pressable
            onPress={() => router.push('/onboarding')}
            style={({ pressed }) => [styles.learnMoreBtn, pressed && styles.buttonPressed]}
          >
            <Text style={styles.learnMoreText}>Learn more</Text>
          </Pressable>
        </View>

        {/* Filter Tabs */}
        <View style={styles.tabBar}>
          <Pressable
            onPress={() => setActiveTab('all')}
            style={[styles.tab, activeTab === 'all' ? styles.tabActive : styles.tabInactive]}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'all' ? styles.tabTextActive : styles.tabTextInactive,
              ]}
            >
              All inspections
            </Text>
            <View
              style={[
                styles.countBadge,
                activeTab === 'all' ? styles.countBadgeActive : styles.countBadgeInactive,
              ]}
            >
              <Text
                style={[
                  styles.countText,
                  activeTab === 'all' ? styles.countTextActive : styles.countTextInactive,
                ]}
              >
                3
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('disputes')}
            style={[styles.tab, activeTab === 'disputes' ? styles.tabActiveDispute : styles.tabInactive]}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'disputes' ? styles.tabTextDispute : styles.tabTextInactive,
              ]}
            >
              Open disputes
            </Text>
            <View style={styles.disputeCountBadge}>
              <Text style={styles.disputeCountText}>1</Text>
            </View>
          </Pressable>
        </View>

        {/* Inspections List */}
        <View style={styles.list}>
          {filteredInspections.map((item) => (
            <InspectionCard
              key={item.id}
              code={item.code}
              title={item.title}
              location={item.location}
              completed={item.completed}
              total={item.total}
              statusType={item.statusType}
              statusLabel={item.statusLabel}
              updatedInfo={item.updatedInfo}
              tag={item.tag}
              onPress={() => router.push(`/inspections/${item.id}`)}
            />
          ))}
        </View>
      </ScrollView>

      {/* Sticky Bottom Action Dock */}
      <View style={[styles.bottomDock, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Pressable
          onPress={() => router.push('/inspections/TR-4091')}
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
  container: {
    flex: 1,
    backgroundColor: FieldMeshColors.surface,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: FieldMeshSpacing.gutter,
    gap: FieldMeshSpacing.md,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: FieldMeshRadius.full,
  },
  offlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: FieldMeshColors.outline,
  },
  offlineText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.onSurfaceVariant,
    letterSpacing: 0.5,
  },
  siteIdText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '600',
    color: FieldMeshColors.onSurfaceVariant,
  },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    padding: 12,
    borderRadius: FieldMeshRadius.lg,
    gap: 12,
  },
  noticeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  noticeText: {
    fontSize: 13,
    color: FieldMeshColors.onSurface,
    fontWeight: '500',
    flex: 1,
  },
  learnMoreBtn: {
    backgroundColor: FieldMeshColors.surfaceContainerHighest,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: FieldMeshRadius.md,
  },
  learnMoreText: {
    fontSize: 12,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: FieldMeshRadius.full,
    gap: 6,
  },
  tabActive: {
    backgroundColor: FieldMeshColors.primary,
  },
  tabActiveDispute: {
    backgroundColor: FieldMeshColors.tertiaryFixed,
  },
  tabInactive: {
    backgroundColor: FieldMeshColors.surfaceContainer,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: FieldMeshColors.onPrimary,
  },
  tabTextDispute: {
    color: FieldMeshColors.onTertiaryFixed,
  },
  tabTextInactive: {
    color: FieldMeshColors.onSurfaceVariant,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: FieldMeshRadius.full,
  },
  countBadgeActive: {
    backgroundColor: FieldMeshColors.primaryContainer,
  },
  countBadgeInactive: {
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
  },
  countTextActive: {
    color: FieldMeshColors.onPrimaryContainer,
  },
  countTextInactive: {
    color: FieldMeshColors.onSurfaceVariant,
  },
  disputeCountBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: FieldMeshColors.tertiaryFixedDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disputeCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.onTertiaryFixed,
  },
  list: {
    gap: FieldMeshSpacing.md,
  },
  bottomDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: FieldMeshColors.surface,
    paddingHorizontal: FieldMeshSpacing.gutter,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: FieldMeshColors.surfaceContainerHigh,
  },
  newInspectionBtn: {
    height: 52,
    backgroundColor: FieldMeshColors.primaryContainer,
    borderRadius: FieldMeshRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: FieldMeshColors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  newInspectionText: {
    fontSize: 15,
    fontWeight: '700',
    color: FieldMeshColors.onPrimary,
    letterSpacing: 0.3,
  },
  meshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: FieldMeshRadius.md,
  },
  meshButtonPressed: {
    opacity: 0.7,
  },
  meshButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: FieldMeshColors.primary,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
