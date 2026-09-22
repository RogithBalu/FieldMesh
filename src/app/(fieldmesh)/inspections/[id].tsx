import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { TriStateVerdict } from '@/components/fieldmesh/TriStateVerdict';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';

export default function ChecklistInspectionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [verdict1, setVerdict1] = useState<'pass' | 'fail' | null>('fail');
  const [temperature, setTemperature] = useState(74);

  return (
    <View style={styles.container}>
      <FieldMeshHeader
        title="Inspection Details"
        category="CHECKLIST"
        showBack={true}
        statusBadge={{ label: 'Saved on phone', variant: 'offline' }}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Sub-Header & Asset Context */}
        <View style={styles.contextCard}>
          <View style={styles.contextHeaderRow}>
            <View style={styles.contextHeaderLeft}>
              <Text style={styles.assetCode}>Asset #TR-8842-N</Text>
              <Text style={styles.assetTitle}>Transformer Safety Inspection</Text>
              <Text style={styles.assetLocation}>North Grid Substation · Sector 4</Text>
            </View>
            <View style={styles.peerBadge}>
              <View style={styles.pulsingDot} />
              <Text style={styles.peerBadgeText}>On site · 4</Text>
            </View>
          </View>

          {/* Progress Strip */}
          <View style={styles.progressCard}>
            <View style={styles.progressRow}>
              <View style={styles.progressNumberGroup}>
                <Text style={styles.progressBigNumber}>8</Text>
                <Text style={styles.progressSubText}>of 12 done</Text>
              </View>
              <View style={styles.reviewBadge}>
                <FieldMeshIcon name="warning" size={14} color={FieldMeshColors.tertiary} />
                <Text style={styles.reviewBadgeText}>1 item needs review</Text>
              </View>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: '66.6%' }]} />
            </View>
          </View>
        </View>

        {/* Vertical Checklist Stack */}
        <View style={styles.itemsStack}>
          {/* ITEM 1: PASS / FAIL WITH DISPUTE */}
          <View style={styles.itemCard}>
            <View style={styles.itemHeader}>
              <View style={styles.itemHeaderLeft}>
                <Text style={styles.itemTitle}>1. Insulation Condition</Text>
                <Text style={styles.itemDesc}>
                  Inspect main dielectric barrier for cracking, tracking or oil saturation.
                </Text>
              </View>
              <View style={styles.critBadge}>
                <Text style={styles.critBadgeText}>CRIT-01</Text>
              </View>
            </View>

            <TriStateVerdict
              verdict={verdict1}
              onVerdictChange={(v) => setVerdict1(v)}
              disputeInfo={{
                text: 'Arun set Pass · Priya set Fail',
                onResolvePress: () => router.push('/inspections/dispute'),
              }}
            />
          </View>

          {/* ITEM 2: OIL TEMPERATURE STEPPER */}
          <View style={styles.itemCard}>
            <View style={styles.itemHeader}>
              <View style={styles.itemHeaderLeft}>
                <Text style={styles.itemTitle}>2. Oil Temperature</Text>
                <View style={styles.readingTagsRow}>
                  <View style={styles.rangeBadge}>
                    <Text style={styles.rangeBadgeText}>Normal: 60–80°C</Text>
                  </View>
                  <View style={styles.toleranceBadge}>
                    <FieldMeshIcon name="verified" size={13} color={FieldMeshColors.secondary} />
                    <Text style={styles.toleranceBadgeText}>Within tolerance</Text>
                  </View>
                </View>
              </View>
              <View style={styles.critBadge}>
                <Text style={styles.critBadgeText}>SENS-04</Text>
              </View>
            </View>

            {/* Stepper Controls */}
            <View style={styles.stepperContainer}>
              <Pressable
                onPress={() => setTemperature((t) => Math.max(0, t - 1))}
                style={({ pressed }) => [styles.stepperBtn, pressed && styles.buttonPressed]}
              >
                <FieldMeshIcon name="remove" size={24} color={FieldMeshColors.onSurface} />
              </Pressable>
              <View style={styles.stepperValueContainer}>
                <Text style={styles.stepperValue}>{temperature}</Text>
                <Text style={styles.stepperUnit}>°C</Text>
              </View>
              <Pressable
                onPress={() => setTemperature((t) => Math.min(150, t + 1))}
                style={({ pressed }) => [styles.stepperBtn, pressed && styles.buttonPressed]}
              >
                <FieldMeshIcon name="add" size={24} color={FieldMeshColors.onSurface} />
              </Pressable>
            </View>

            <View style={styles.stepperFooter}>
              <Text style={styles.stepperFooterText}>Analog Gauge Reader</Text>
              <Text style={styles.stepperFooterText}>Target: 70.0°C (±10)</Text>
            </View>
          </View>

          {/* ITEM 3: FIELD NOTES CARD */}
          <View style={styles.itemCard}>
            <View style={styles.itemHeader}>
              <View style={styles.itemHeaderLeft}>
                <Text style={styles.itemTitle}>3. Bushing Terminal Seals</Text>
                <Text style={styles.itemDesc}>High-voltage gasket degradation check</Text>
              </View>
              <View style={styles.passPill}>
                <FieldMeshIcon name="check" size={14} color={FieldMeshColors.onSecondaryFixed} />
                <Text style={styles.passPillText}>PASS</Text>
              </View>
            </View>

            <View style={styles.notesBox}>
              <View style={styles.notesHeader}>
                <FieldMeshIcon name="edit_note" size={18} color={FieldMeshColors.primary} />
                <Text style={styles.notesHeaderText}>Note added by Inspector</Text>
              </View>
              <Text style={styles.notesBody}>
                Minor surface weeping observed on Phase B secondary seal. Cleaned with solvent, no active leak. Recommended for torque recheck on 90-day cycle.
              </Text>
              <View style={styles.notesFooter}>
                <Text style={styles.notesMeta}>Logged 10:42 AM</Text>
                <Text style={styles.notesMeta}>Glove-voice transcription</Text>
              </View>
            </View>
          </View>

          {/* ITEM 4: PHOTO ATTACHMENT CARD */}
          <View style={styles.itemCard}>
            <View style={styles.itemHeader}>
              <View style={styles.itemHeaderLeft}>
                <Text style={styles.itemTitle}>4. Pressure Relief Device</Text>
                <Text style={styles.itemDesc}>Physical indicator pin alignment</Text>
              </View>
              <View style={styles.photoCountBadge}>
                <FieldMeshIcon name="photo_camera" size={14} color={FieldMeshColors.onSurfaceVariant} />
                <Text style={styles.photoCountText}>2 photos</Text>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [styles.photoButton, pressed && styles.buttonPressed]}
            >
              <FieldMeshIcon name="add_a_photo" size={22} color={FieldMeshColors.onSurface} />
              <Text style={styles.photoButtonText}>+ Take photo</Text>
            </Pressable>

            {/* Thumbnail Strip */}
            <View style={styles.thumbStrip}>
              <View style={styles.thumbContainer}>
                <Image
                  source={{
                    uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAudFHb1arlSmdfSbgvLcMBM9MAnb4LN6quWklIKwbLbVs31Hdp0AmHXloyNnPhl7zdWSza4GX_JUyyTNJ4azCxF5eXwUdoB2TgGhX7v_FLhE9UJFPwEWX17fHQtn35nHZouLhkbCWjq3L-a1tONuGBqpyovcR99naL2NAG4lyASayQ7KUW395s-IvEVT-1PFrGvqikYbk9llANx8gE4PxzhlgYy_gbZrBUJcaERPDw4uFAaT5y8bH7',
                  }}
                  style={styles.thumbImage}
                />
                <View style={styles.thumbTag}>
                  <Text style={styles.thumbTagText}>P-1</Text>
                </View>
              </View>

              <View style={styles.thumbContainer}>
                <Image
                  source={{
                    uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBv4dvQqQCy6nnXfuBSPlx-jthIGkDl2IHb-GppkI5ptNgGMlguSqSZH_b0bz2yrXM0szKQRpmTjZI_Ie1Pj9QlzRCucxLpyCnk0hlkoM5V1uGds0-fuHgBBmfvacUnHre3k-Oxlc1gBj8U--dVugzgD5lmeL1mSqtl5eZDRkVQRdJydAcV92_9PkQYqiNIWipHvuR3BopPzdgxq1B21nS6WmQ_PM3KLYT0_KyAAXydxOhE_9zGvmNn',
                  }}
                  style={styles.thumbImage}
                />
                <View style={styles.thumbTag}>
                  <Text style={styles.thumbTagText}>P-2</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Sticky Bottom Dock */}
      <View style={[styles.bottomDock, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Pressable
          onPress={() => router.push('/inspections/dispute')}
          style={({ pressed }) => [styles.submitBtn, pressed && styles.buttonPressed]}
        >
          <FieldMeshIcon name="shield" size={20} color={FieldMeshColors.onPrimary} />
          <Text style={styles.submitBtnText}>Review 1 Dispute & Sign Off</Text>
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
  contextCard: {
    backgroundColor: FieldMeshColors.surfaceLowest,
    padding: FieldMeshSpacing.md,
    borderRadius: FieldMeshRadius.lg,
    borderWidth: 1,
    borderColor: FieldMeshColors.surfaceContainerHigh,
    gap: 12,
  },
  contextHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  contextHeaderLeft: {
    flex: 1,
    paddingRight: 8,
  },
  assetCode: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.onSurfaceVariant,
    letterSpacing: 0.5,
  },
  assetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
    marginTop: 2,
  },
  assetLocation: {
    fontSize: 13,
    color: FieldMeshColors.onSurfaceVariant,
    marginTop: 2,
  },
  peerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: FieldMeshColors.secondaryFixed,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: FieldMeshRadius.full,
  },
  pulsingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: FieldMeshColors.secondary,
  },
  peerBadgeText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.onSecondaryFixed,
  },
  progressCard: {
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    padding: 12,
    borderRadius: FieldMeshRadius.md,
    gap: 8,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressNumberGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  progressBigNumber: {
    fontSize: 22,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
    fontFamily: 'monospace',
  },
  progressSubText: {
    fontSize: 13,
    color: FieldMeshColors.onSurfaceVariant,
    fontWeight: '600',
  },
  reviewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: FieldMeshColors.tertiaryFixed,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: FieldMeshRadius.full,
  },
  reviewBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.onTertiaryFixed,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: FieldMeshColors.surfaceContainerHighest,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: FieldMeshColors.primary,
  },
  itemsStack: {
    gap: FieldMeshSpacing.md,
  },
  itemCard: {
    backgroundColor: FieldMeshColors.surfaceLowest,
    padding: FieldMeshSpacing.md,
    borderRadius: FieldMeshRadius.lg,
    borderWidth: 1,
    borderColor: FieldMeshColors.surfaceContainerHigh,
    gap: 12,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  itemHeaderLeft: {
    flex: 1,
    paddingRight: 8,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  itemDesc: {
    fontSize: 13,
    color: FieldMeshColors.onSurfaceVariant,
    marginTop: 3,
    lineHeight: 18,
  },
  critBadge: {
    backgroundColor: FieldMeshColors.surfaceContainerHighest,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: FieldMeshRadius.xs,
  },
  critBadgeText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.onSurfaceVariant,
  },
  readingTagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  rangeBadge: {
    backgroundColor: FieldMeshColors.tertiaryFixed,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: FieldMeshRadius.xs,
  },
  rangeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.onTertiaryFixed,
  },
  toleranceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  toleranceBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: FieldMeshColors.secondary,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    padding: 6,
    borderRadius: FieldMeshRadius.lg,
  },
  stepperBtn: {
    width: 54,
    height: 54,
    borderRadius: FieldMeshRadius.md,
    backgroundColor: FieldMeshColors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValueContainer: {
    flex: 1,
    height: 54,
    borderRadius: FieldMeshRadius.md,
    backgroundColor: FieldMeshColors.surfaceLowest,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  stepperValue: {
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: FieldMeshColors.onSurface,
  },
  stepperUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: FieldMeshColors.onSurfaceVariant,
    marginBottom: 4,
  },
  stepperFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepperFooterText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: FieldMeshColors.onSurfaceVariant,
  },
  passPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: FieldMeshColors.secondaryFixed,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: FieldMeshRadius.xs,
  },
  passPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.onSecondaryFixed,
  },
  notesBox: {
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    padding: 12,
    borderRadius: FieldMeshRadius.md,
    gap: 6,
  },
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  notesHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  notesBody: {
    fontSize: 13,
    color: FieldMeshColors.onSurface,
    lineHeight: 19,
  },
  notesFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: FieldMeshColors.surfaceContainerHigh,
    paddingTop: 6,
    marginTop: 4,
  },
  notesMeta: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: FieldMeshColors.onSurfaceVariant,
  },
  photoCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: FieldMeshRadius.full,
  },
  photoCountText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: FieldMeshColors.onSurfaceVariant,
  },
  photoButton: {
    height: 52,
    borderRadius: FieldMeshRadius.md,
    backgroundColor: FieldMeshColors.surfaceContainerHighest,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  photoButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  thumbStrip: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  thumbContainer: {
    width: 76,
    height: 76,
    borderRadius: FieldMeshRadius.md,
    overflow: 'hidden',
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbTag: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(20, 27, 43, 0.85)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  thumbTagText: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: '#ffffff',
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
  submitBtn: {
    height: 54,
    borderRadius: FieldMeshRadius.lg,
    backgroundColor: FieldMeshColors.primaryContainer,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: FieldMeshColors.onPrimary,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
