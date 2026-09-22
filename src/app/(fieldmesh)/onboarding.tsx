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
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';

interface StepData {
  stepNumber: number;
  tag: string;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  badgeText: string;
  features: { icon: string; title: string; desc: string }[];
  telemetry: string;
  buttonLabel: string;
}

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [currentStep, setCurrentStep] = useState(0);

  const steps: StepData[] = [
    {
      stepNumber: 1,
      tag: 'PROTOCOL DEPLOYMENT',
      title: '01 — WORK OFFLINE',
      subtitle: 'Keep inspecting even without internet.',
      description:
        'Every checklist, reading, photo, and note is securely stored directly on your phone. Never lose inspection data on remote substations or underground vaults.',
      icon: 'phone_android',
      badgeText: 'SAVED ON PHONE • 100% LOCAL',
      features: [
        {
          icon: 'database',
          title: 'Instant local storage with zero lag',
          desc: 'Forms render and save in real-time straight to non-volatile device memory.',
        },
        {
          icon: 'photo_camera',
          title: 'Full camera & voice notes without cellular',
          desc: 'Capture high-definition evidence tags regardless of signal blackout zones.',
        },
      ],
      telemetry: 'STORAGE ENGINE: ACTIVE · ZERO CELL REQUIRED',
      buttonLabel: 'Next: Team Sync',
    },
    {
      stepNumber: 2,
      tag: 'PEER-TO-PEER MESH',
      title: '02 — WORK AS A TEAM',
      subtitle: 'Synchronize effortlessly peer-to-peer.',
      description:
        'Connect directly with nearby teammates using device-to-device local wireless mesh. Updates automatically relay through the nearest connected device.',
      icon: 'sensors',
      badgeText: 'MULTI-HOP RELAY ACTIVE',
      features: [
        {
          icon: 'swap_horiz',
          title: 'Automatic device-to-device sync',
          desc: 'No cloud server required on site; changes replicate instantaneously.',
        },
        {
          icon: 'badge',
          title: 'Mesh presence & team awareness',
          desc: 'See which teammates are currently on site and what bays they are inspecting.',
        },
      ],
      telemetry: 'MESH PROTOCOL: v2.4 · 4 PEERS REACHABLE',
      buttonLabel: 'Next: Audit Trust',
    },
    {
      stepNumber: 3,
      tag: 'CRYPTOGRAPHIC AUDIT',
      title: '03 — TRUST EVERY CHANGE',
      subtitle: 'Tamper-proof field verification trail.',
      description:
        'Every inspection decision, timestamp, and photo is signed cryptographically with local keys. Safety conflicts default to FAIL until authorized review.',
      icon: 'shield',
      badgeText: 'AES-256 SIGNED LOGS',
      features: [
        {
          icon: 'rule',
          title: 'Automated conflict detection',
          desc: 'Instant alerting when two inspectors submit differing readings offline.',
        },
        {
          icon: 'verified_user',
          title: 'Immutable tamper-proof logs',
          desc: 'Export signed cryptographic verification bundles directly to compliance auditors.',
        },
      ],
      telemetry: 'AUDIT LEDGER: ACTIVE · COMPLIANCE READY',
      buttonLabel: 'Enter FieldMesh Platform',
    },
  ];

  const step = steps[currentStep];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      router.replace('/inspections');
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top, 16) + 8, paddingBottom: insets.bottom + 20 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Step Bar & Dismiss Controls */}
        <View style={styles.topBar}>
          <View style={styles.stepIndicatorsGroup}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>STEP {step.stepNumber} OF 3</Text>
            </View>
            <View style={styles.barsRow}>
              {[0, 1, 2].map((idx) => (
                <View
                  key={idx}
                  style={[
                    styles.indicatorBar,
                    idx === currentStep ? styles.indicatorActive : styles.indicatorInactive,
                  ]}
                />
              ))}
            </View>
          </View>
          <Pressable onPress={() => router.replace('/inspections')}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </View>

        {/* Technical Schematic Graphic */}
        <View style={styles.graphicCard}>
          <View style={styles.iconCircle}>
            <FieldMeshIcon name={step.icon} size={48} color={FieldMeshColors.primary} />
            <View style={styles.floatingCheck}>
              <FieldMeshIcon name="check" size={16} color={FieldMeshColors.onSecondary} />
            </View>
          </View>
          <View style={styles.badgePill}>
            <FieldMeshIcon name="save" size={14} color={FieldMeshColors.secondary} />
            <Text style={styles.badgePillText}>{step.badgeText}</Text>
          </View>
        </View>

        {/* Typography Block */}
        <View style={styles.textBlock}>
          <Text style={styles.tag}>{step.tag}</Text>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.subtitle}>{step.subtitle}</Text>
          <Text style={styles.desc}>{step.description}</Text>
        </View>

        {/* Feature Cards */}
        <View style={styles.featuresStack}>
          {step.features.map((feat, i) => (
            <View key={i} style={styles.featureCard}>
              <View style={styles.featureIconContainer}>
                <FieldMeshIcon name={feat.icon} size={22} color={FieldMeshColors.primary} />
              </View>
              <View style={styles.featureContent}>
                <Text style={styles.featureTitle}>{feat.title}</Text>
                <Text style={styles.featureDesc}>{feat.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Telemetry Status Bar */}
        <View style={styles.telemetryBar}>
          <View style={styles.greenDot} />
          <Text style={styles.telemetryText}>{step.telemetry}</Text>
        </View>

        {/* Bottom Button */}
        <View style={styles.bottomSection}>
          <Pressable
            onPress={handleNext}
            style={({ pressed }) => [styles.nextBtn, pressed && styles.btnPressed]}
          >
            <Text style={styles.nextBtnText}>{step.buttonLabel}</Text>
            <FieldMeshIcon name="arrow_forward" size={18} color={FieldMeshColors.onPrimary} />
          </Pressable>

          <Text style={styles.footerNote}>
            FieldMesh Core v4.12 • Certified Offline Architecture
          </Text>
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
    paddingHorizontal: FieldMeshSpacing.gutter,
    gap: FieldMeshSpacing.md,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepIndicatorsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepBadge: {
    backgroundColor: FieldMeshColors.primaryContainer,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: FieldMeshRadius.xs,
  },
  stepBadgeText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
  },
  barsRow: {
    flexDirection: 'row',
    gap: 4,
  },
  indicatorBar: {
    height: 4,
    borderRadius: 2,
  },
  indicatorActive: {
    width: 24,
    backgroundColor: FieldMeshColors.primary,
  },
  indicatorInactive: {
    width: 8,
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
  },
  skipText: {
    fontSize: 13,
    fontWeight: '600',
    color: FieldMeshColors.onSurfaceVariant,
  },
  graphicCard: {
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    borderRadius: FieldMeshRadius.lg,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: FieldMeshRadius.lg,
    backgroundColor: FieldMeshColors.surfaceLowest,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  floatingCheck: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: FieldMeshColors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: FieldMeshColors.surfaceContainerHighest,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: FieldMeshRadius.xs,
  },
  badgePillText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  textBlock: {
    gap: 4,
  },
  tag: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.primary,
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: FieldMeshColors.onSurface,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '700',
    color: FieldMeshColors.primary,
  },
  desc: {
    fontSize: 13,
    color: FieldMeshColors.onSurfaceVariant,
    lineHeight: 19,
    marginTop: 4,
  },
  featuresStack: {
    gap: 10,
  },
  featureCard: {
    backgroundColor: FieldMeshColors.surfaceLowest,
    borderRadius: FieldMeshRadius.lg,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: FieldMeshColors.surfaceContainerHigh,
  },
  featureIconContainer: {
    width: 38,
    height: 38,
    borderRadius: FieldMeshRadius.md,
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  featureDesc: {
    fontSize: 12,
    color: FieldMeshColors.onSurfaceVariant,
    marginTop: 2,
    lineHeight: 16,
  },
  telemetryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    padding: 10,
    borderRadius: FieldMeshRadius.md,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: FieldMeshColors.secondary,
  },
  telemetryText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '600',
    color: FieldMeshColors.onSurfaceVariant,
  },
  bottomSection: {
    gap: 8,
    paddingTop: 8,
  },
  nextBtn: {
    height: 52,
    borderRadius: FieldMeshRadius.lg,
    backgroundColor: FieldMeshColors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nextBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: FieldMeshColors.onPrimary,
  },
  footerNote: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: FieldMeshColors.onSurfaceVariant,
    textAlign: 'center',
  },
  btnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
});
