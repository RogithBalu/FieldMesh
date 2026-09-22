import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FieldMeshColors, FieldMeshRadius } from '@/constants/fieldMeshTheme';

export interface SyncStatusPillProps {
  label: string;
  variant?: 'offline' | 'active' | 'warning' | 'connected';
  pulse?: boolean;
}

export const SyncStatusPill: React.FC<SyncStatusPillProps> = ({
  label,
  variant = 'offline',
}) => {
  const getBadgeStyle = () => {
    switch (variant) {
      case 'active':
      case 'connected':
        return {
          container: styles.connectedContainer,
          text: styles.connectedText,
          dot: styles.connectedDot,
        };
      case 'warning':
        return {
          container: styles.warningContainer,
          text: styles.warningText,
          dot: styles.warningDot,
        };
      case 'offline':
      default:
        return {
          container: styles.offlineContainer,
          text: styles.offlineText,
          dot: styles.offlineDot,
        };
    }
  };

  const badge = getBadgeStyle();

  return (
    <View style={[styles.pill, badge.container]}>
      <View style={[styles.dot, badge.dot]} />
      <Text style={[styles.text, badge.text]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: FieldMeshRadius.full,
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  offlineContainer: {
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
  },
  offlineText: {
    color: FieldMeshColors.onSurfaceVariant,
  },
  offlineDot: {
    backgroundColor: FieldMeshColors.outline,
  },
  connectedContainer: {
    backgroundColor: FieldMeshColors.secondaryContainer,
  },
  connectedText: {
    color: FieldMeshColors.onSecondaryContainer,
  },
  connectedDot: {
    backgroundColor: FieldMeshColors.secondary,
  },
  warningContainer: {
    backgroundColor: FieldMeshColors.tertiaryFixed,
  },
  warningText: {
    color: FieldMeshColors.onTertiaryFixed,
  },
  warningDot: {
    backgroundColor: FieldMeshColors.tertiaryContainer,
  },
});
