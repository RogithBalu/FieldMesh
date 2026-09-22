import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  TextInput,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';

export default function SafetyDisputeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideNotes, setOverrideNotes] = useState('');

  const handleConfirmFail = () => {
    Alert.alert(
      'Safety Verdict Confirmed',
      'FAIL has been recorded as the authoritative safety verdict across the mesh network.',
      [{ text: 'Return to Checklist', onPress: () => router.back() }]
    );
  };

  const handleConfirmPass = () => {
    if (!overrideNotes.trim()) {
      Alert.alert('Explanation Required', 'Please enter an authorized justification to override safety FAIL.');
      return;
    }
    Alert.alert(
      'Override Signed & Confirmed',
      'PASS override signed cryptographically and queued for mesh sync.',
      [{ text: 'Return to Checklist', onPress: () => router.back() }]
    );
  };

  return (
    <View style={styles.container}>
      <FieldMeshHeader
        title="Safety Dispute"
        category="RESOLUTION"
        showBack={true}
        statusBadge={{ label: 'Saved on phone', variant: 'offline' }}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Navigation context bar */}
        <View style={styles.contextBar}>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <FieldMeshIcon name="chevron_left" size={20} color={FieldMeshColors.primary} />
            <Text style={styles.backLinkText}>Back to checklist</Text>
          </Pressable>
          <View style={styles.relayBadge}>
            <View style={styles.relayDot} />
            <Text style={styles.relayText}>Relaying via Ravi</Text>
          </View>
        </View>

        {/* Item Header */}
        <View style={styles.itemHeader}>
          <View style={styles.itemTagRow}>
            <Text style={styles.itemTag}>Item 1 of 12 · Transformer Safety</Text>
            <FieldMeshIcon name="gpp_maybe" size={18} color={FieldMeshColors.error} />
          </View>
          <Text style={styles.itemTitle}>Transformer insulation condition</Text>
          <View style={styles.locationRow}>
            <FieldMeshIcon name="location_on" size={16} color={FieldMeshColors.outline} />
            <Text style={styles.locationText}>North Grid Substation — Bay 2</Text>
          </View>
        </View>

        {/* Prominent Amber Conflict Card */}
        <View style={styles.conflictCard}>
          <View style={styles.conflictHeader}>
            <View style={styles.warningIconCircle}>
              <FieldMeshIcon name="warning" size={20} color={FieldMeshColors.tertiaryFixed} />
            </View>
            <View style={styles.conflictHeaderText}>
              <Text style={styles.conflictTitle}>Conflicting inputs detected</Text>
              <Text style={styles.conflictSubtitle}>
                Two differing verifications logged offline in mesh
              </Text>
            </View>
          </View>

          {/* Split View Comparison */}
          <View style={styles.splitGrid}>
            {/* Arun's Record */}
            <View style={styles.recordBox}>
              <View style={styles.peerRow}>
                <View style={styles.peerAvatar}>
                  <Text style={styles.peerInitial}>A</Text>
                </View>
                <View style={styles.peerInfo}>
                  <Text style={styles.peerName}>Arun</Text>
                  <Text style={styles.peerDevice}>Galaxy XCover</Text>
                </View>
              </View>
              <View style={styles.timeRow}>
                <FieldMeshIcon name="schedule" size={13} color={FieldMeshColors.onSurfaceVariant} />
                <Text style={styles.timeText}>10:48 AM</Text>
              </View>
              <View style={styles.verdictDisplayPass}>
                <Text style={styles.passText}>PASS</Text>
                <Text style={styles.noNotes}>No notes attached</Text>
              </View>
            </View>

            {/* Priya's Record */}
            <View style={[styles.recordBox, styles.recordBoxAlert]}>
              <View style={styles.peerRow}>
                <View style={[styles.peerAvatar, styles.avatarAlert]}>
                  <Text style={[styles.peerInitial, styles.textAlert]}>P</Text>
                </View>
                <View style={styles.peerInfo}>
                  <Text style={styles.peerName}>Priya</Text>
                  <Text style={styles.peerDevice}>iPad Mini</Text>
                </View>
              </View>
              <View style={styles.timeRow}>
                <FieldMeshIcon name="schedule" size={13} color={FieldMeshColors.onSurfaceVariant} />
                <Text style={styles.timeText}>11:07 AM</Text>
              </View>
              <View style={styles.verdictDisplayFail}>
                <Text style={styles.failText}>FAIL</Text>
                <Text style={styles.failReason} numberOfLines={3}>
                  {"\"Detected 3mm axial crack on lower ceramic shed with visible carbon tracking.\""}
                </Text>
              </View>
            </View>
          </View>

          {/* Evidence Attachment Preview */}
          <View style={styles.evidenceCard}>
            <View style={styles.evidenceThumb}>
              <Image
                source={{
                  uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBv4dvQqQCy6nnXfuBSPlx-jthIGkDl2IHb-GppkI5ptNgGMlguSqSZH_b0bz2yrXM0szKQRpmTjZI_Ie1Pj9QlzRCucxLpyCnk0hlkoM5V1uGds0-fuHgBBmfvacUnHre3k-Oxlc1gBj8U--dVugzgD5lmeL1mSqtl5eZDRkVQRdJydAcV92_9PkQYqiNIWipHvuR3BopPzdgxq1B21nS6WmQ_PM3KLYT0_KyAAXydxOhE_9zGvmNn',
                }}
                style={styles.evidenceImage}
              />
              <View style={styles.crackTag}>
                <Text style={styles.crackTagText}>CRACK</Text>
              </View>
            </View>
            <View style={styles.evidenceMeta}>
              <View style={styles.fileNameRow}>
                <FieldMeshIcon name="photo_camera" size={16} color={FieldMeshColors.error} />
                <Text style={styles.fileName}>shed_crack_macro_01.raw</Text>
              </View>
              <Text style={styles.fileDetails}>Captured by Priya · 4.2 MB encrypted</Text>
              <Text style={styles.fileHint}>Tap to inspect full 4K view</Text>
            </View>
          </View>
        </View>

        {/* Safety Rule Explanation Banner */}
        <View style={styles.safetyRuleBanner}>
          <View style={styles.safetyIconContainer}>
            <FieldMeshIcon name="shield" size={18} color={FieldMeshColors.onError} />
          </View>
          <View style={styles.safetyRuleContent}>
            <Text style={styles.safetyRuleTitle}>Fail applied for safety.</Text>
            <Text style={styles.safetyRuleBody}>
              FieldMesh automatically defaults to{' '}
              <Text style={styles.failUnderline}>FAIL</Text> whenever a safety-critical conflict
              occurs until manually reviewed and confirmed by an authorized lead.
            </Text>
          </View>
        </View>

        {/* Human-in-the-Loop Verdict Controls */}
        <View style={styles.decisionSection}>
          <View style={styles.decisionHeader}>
            <Text style={styles.decisionLabel}>Human-in-the-Loop Verdict</Text>
            <Text style={styles.authRequired}>Auth L3 Required</Text>
          </View>

          {/* Action 1: Confirm FAIL */}
          <Pressable
            onPress={handleConfirmFail}
            style={({ pressed }) => [styles.confirmFailBtn, pressed && styles.btnPressed]}
          >
            <FieldMeshIcon name="verified" size={22} color={FieldMeshColors.onError} />
            <Text style={styles.confirmFailBtnText}>Confirm FAIL as final result</Text>
          </Pressable>

          {/* Action 2: Change to PASS */}
          <Pressable
            onPress={() => setShowOverrideForm(!showOverrideForm)}
            style={({ pressed }) => [styles.changePassBtn, pressed && styles.btnPressed]}
          >
            <FieldMeshIcon name="swap_horiz" size={20} color={FieldMeshColors.secondary} />
            <Text style={styles.changePassBtnText}>Change to PASS with explanation</Text>
          </Pressable>

          {/* Collapsible Pass Override Tray */}
          {showOverrideForm && (
            <View style={styles.overrideForm}>
              <View style={styles.overrideLabelRow}>
                <FieldMeshIcon name="edit_note" size={18} color={FieldMeshColors.error} />
                <Text style={styles.overrideLabelText}>Mandatory Safety Override Reason:</Text>
              </View>
              <TextInput
                style={styles.overrideInput}
                multiline
                numberOfLines={3}
                placeholder="e.g., Cleaned shed; surface dust was mistaken for carbon track. Dielectric tested OK at 22kV."
                placeholderTextColor={FieldMeshColors.outline}
                value={overrideNotes}
                onChangeText={setOverrideNotes}
              />
              <Pressable
                onPress={handleConfirmPass}
                style={({ pressed }) => [styles.submitOverrideBtn, pressed && styles.btnPressed]}
              >
                <FieldMeshIcon name="check_circle" size={20} color={FieldMeshColors.onSecondary} />
                <Text style={styles.submitOverrideText}>Sign & Confirm PASS Override</Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
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
  contextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: -4,
  },
  backLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: FieldMeshColors.primary,
  },
  relayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: FieldMeshRadius.full,
  },
  relayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: FieldMeshColors.secondary,
  },
  relayText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '600',
    color: FieldMeshColors.onSurfaceVariant,
  },
  itemHeader: {
    gap: 4,
  },
  itemTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemTag: {
    backgroundColor: FieldMeshColors.surfaceContainerHighest,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: FieldMeshRadius.xs,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '600',
    color: FieldMeshColors.onSurfaceVariant,
  },
  itemTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    fontSize: 13,
    color: FieldMeshColors.onSurfaceVariant,
  },
  conflictCard: {
    backgroundColor: FieldMeshColors.tertiaryFixed,
    borderRadius: FieldMeshRadius.lg,
    padding: FieldMeshSpacing.md,
    gap: 12,
  },
  conflictHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 182, 142, 0.4)',
    paddingBottom: 8,
  },
  warningIconCircle: {
    width: 32,
    height: 32,
    borderRadius: FieldMeshRadius.md,
    backgroundColor: FieldMeshColors.tertiaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conflictHeaderText: {
    flex: 1,
  },
  conflictTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: FieldMeshColors.onTertiaryFixed,
  },
  conflictSubtitle: {
    fontSize: 12,
    color: FieldMeshColors.onTertiaryFixedVariant,
    marginTop: 1,
  },
  splitGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  recordBox: {
    flex: 1,
    backgroundColor: FieldMeshColors.surfaceLowest,
    borderRadius: FieldMeshRadius.md,
    padding: 10,
    justifyContent: 'space-between',
    gap: 8,
  },
  recordBoxAlert: {
    borderWidth: 1.5,
    borderColor: 'rgba(186, 26, 26, 0.3)',
  },
  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  peerAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: FieldMeshColors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarAlert: {
    backgroundColor: FieldMeshColors.errorContainer,
  },
  peerInitial: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  textAlert: {
    color: FieldMeshColors.error,
  },
  peerInfo: {
    flex: 1,
  },
  peerName: {
    fontSize: 12,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  peerDevice: {
    fontSize: 10,
    color: FieldMeshColors.onSurfaceVariant,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: FieldMeshColors.onSurfaceVariant,
  },
  verdictDisplayPass: {
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    padding: 8,
    borderRadius: FieldMeshRadius.xs,
    alignItems: 'center',
    gap: 4,
  },
  passText: {
    fontSize: 13,
    fontWeight: '800',
    color: FieldMeshColors.secondary,
    backgroundColor: FieldMeshColors.secondaryContainer,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: FieldMeshRadius.xs,
  },
  noNotes: {
    fontSize: 10,
    color: FieldMeshColors.outline,
    fontStyle: 'italic',
  },
  verdictDisplayFail: {
    backgroundColor: FieldMeshColors.errorContainer,
    padding: 8,
    borderRadius: FieldMeshRadius.xs,
    alignItems: 'center',
    gap: 4,
  },
  failText: {
    fontSize: 13,
    fontWeight: '800',
    color: FieldMeshColors.onError,
    backgroundColor: FieldMeshColors.error,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: FieldMeshRadius.xs,
  },
  failReason: {
    fontSize: 10,
    color: FieldMeshColors.error,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 14,
  },
  evidenceCard: {
    backgroundColor: FieldMeshColors.surfaceLowest,
    borderRadius: FieldMeshRadius.md,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  evidenceThumb: {
    width: 54,
    height: 54,
    borderRadius: FieldMeshRadius.md,
    overflow: 'hidden',
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
  },
  evidenceImage: {
    width: '100%',
    height: '100%',
  },
  crackTag: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(20, 27, 43, 0.85)',
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderTopLeftRadius: 2,
  },
  crackTagText: {
    fontFamily: 'monospace',
    fontSize: 8,
    fontWeight: '700',
    color: '#ffffff',
  },
  evidenceMeta: {
    flex: 1,
  },
  fileNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  fileName: {
    fontSize: 12,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  fileDetails: {
    fontSize: 11,
    color: FieldMeshColors.onSurfaceVariant,
    marginTop: 2,
  },
  fileHint: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: FieldMeshColors.primaryContainer,
    marginTop: 2,
  },
  safetyRuleBanner: {
    backgroundColor: FieldMeshColors.inverseSurface,
    padding: 14,
    borderRadius: FieldMeshRadius.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  safetyIconContainer: {
    width: 28,
    height: 28,
    borderRadius: FieldMeshRadius.sm,
    backgroundColor: FieldMeshColors.error,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  safetyRuleContent: {
    flex: 1,
    gap: 4,
  },
  safetyRuleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: FieldMeshColors.inverseOnSurface,
  },
  safetyRuleBody: {
    fontSize: 12,
    color: FieldMeshColors.surfaceContainerHighest,
    lineHeight: 18,
  },
  failUnderline: {
    color: FieldMeshColors.errorContainer,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  decisionSection: {
    gap: 10,
  },
  decisionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  decisionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.outline,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  authRequired: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: FieldMeshColors.onSurfaceVariant,
  },
  confirmFailBtn: {
    height: 56,
    borderRadius: FieldMeshRadius.lg,
    backgroundColor: FieldMeshColors.error,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: FieldMeshColors.error,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  confirmFailBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: FieldMeshColors.onError,
  },
  changePassBtn: {
    height: 52,
    borderRadius: FieldMeshRadius.lg,
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  changePassBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  overrideForm: {
    backgroundColor: FieldMeshColors.surfaceContainer,
    padding: 12,
    borderRadius: FieldMeshRadius.lg,
    gap: 10,
    marginTop: 4,
  },
  overrideLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  overrideLabelText: {
    fontSize: 12,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  overrideInput: {
    backgroundColor: FieldMeshColors.surfaceLowest,
    borderRadius: FieldMeshRadius.md,
    padding: 10,
    fontSize: 13,
    color: FieldMeshColors.onSurface,
    textAlignVertical: 'top',
    minHeight: 60,
  },
  submitOverrideBtn: {
    height: 50,
    borderRadius: FieldMeshRadius.md,
    backgroundColor: FieldMeshColors.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitOverrideText: {
    fontSize: 14,
    fontWeight: '700',
    color: FieldMeshColors.onSecondary,
  },
  btnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
});
