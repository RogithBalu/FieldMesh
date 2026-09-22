import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshIcon } from './FieldMeshIcon';

export type VerdictState = 'pass' | 'fail' | null;

interface TriStateVerdictProps {
  verdict: VerdictState;
  onVerdictChange: (newVerdict: 'pass' | 'fail') => void;
  disputeInfo?: {
    text: string;
    onResolvePress?: () => void;
  };
}

export const TriStateVerdict: React.FC<TriStateVerdictProps> = ({
  verdict,
  onVerdictChange,
  disputeInfo,
}) => {
  return (
    <View style={styles.container}>
      {/* 56px Glove-friendly Verdict Toggle Grid */}
      <View style={styles.grid}>
        <Pressable
          onPress={() => onVerdictChange('pass')}
          style={({ pressed }) => [
            styles.button,
            verdict === 'pass' ? styles.passActive : styles.inactiveButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <FieldMeshIcon
            name="check_circle"
            size={22}
            color={verdict === 'pass' ? FieldMeshColors.onSecondary : FieldMeshColors.secondary}
          />
          <Text
            style={[
              styles.buttonText,
              verdict === 'pass' ? styles.passActiveText : styles.inactiveButtonText,
            ]}
          >
            PASS
          </Text>
        </Pressable>

        <Pressable
          onPress={() => onVerdictChange('fail')}
          style={({ pressed }) => [
            styles.button,
            verdict === 'fail' ? styles.failActive : styles.inactiveButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <FieldMeshIcon
            name="cancel"
            size={22}
            color={verdict === 'fail' ? FieldMeshColors.onError : FieldMeshColors.error}
          />
          <Text
            style={[
              styles.buttonText,
              verdict === 'fail' ? styles.failActiveText : styles.inactiveButtonText,
            ]}
          >
            FAIL
          </Text>
        </Pressable>
      </View>

      {/* Open Team Dispute Amber Badge */}
      {disputeInfo && (
        <View style={styles.disputeBanner}>
          <View style={styles.disputeLeft}>
            <FieldMeshIcon name="rule" size={18} color={FieldMeshColors.tertiary} />
            <Text style={styles.disputeText} numberOfLines={1}>
              {disputeInfo.text}
            </Text>
          </View>
          {disputeInfo.onResolvePress && (
            <Pressable
              onPress={disputeInfo.onResolvePress}
              style={({ pressed }) => [
                styles.resolveButton,
                pressed && styles.resolveButtonPressed,
              ]}
            >
              <Text style={styles.resolveButtonText}>Resolve</Text>
              <FieldMeshIcon name="arrow_forward" size={14} color={FieldMeshColors.onTertiary} />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: FieldMeshSpacing.sm,
  },
  grid: {
    flexDirection: 'row',
    gap: FieldMeshSpacing.sm,
  },
  button: {
    flex: 1,
    height: 56,
    borderRadius: FieldMeshRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  inactiveButton: {
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    borderColor: FieldMeshColors.surfaceContainerHigh,
  },
  inactiveButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  passActive: {
    backgroundColor: FieldMeshColors.secondary,
    borderColor: FieldMeshColors.secondary,
  },
  passActiveText: {
    fontSize: 15,
    fontWeight: '700',
    color: FieldMeshColors.onSecondary,
  },
  failActive: {
    backgroundColor: FieldMeshColors.error,
    borderColor: FieldMeshColors.error,
  },
  failActiveText: {
    fontSize: 15,
    fontWeight: '700',
    color: FieldMeshColors.onError,
  },
  buttonText: {
    letterSpacing: 0.5,
  },
  disputeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: FieldMeshSpacing.sm,
    backgroundColor: FieldMeshColors.tertiaryFixed,
    borderRadius: FieldMeshRadius.md,
    gap: 8,
  },
  disputeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  disputeText: {
    fontSize: 12,
    fontWeight: '600',
    color: FieldMeshColors.onTertiaryFixed,
    flex: 1,
  },
  resolveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: FieldMeshColors.tertiaryContainer,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: FieldMeshRadius.sm,
    gap: 4,
  },
  resolveButtonPressed: {
    opacity: 0.8,
  },
  resolveButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: FieldMeshColors.onTertiary,
  },
});
