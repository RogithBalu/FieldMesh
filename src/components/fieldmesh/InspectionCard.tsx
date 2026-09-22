import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshIcon } from './FieldMeshIcon';

export interface InspectionCardProps {
  code: string;
  title: string;
  location: string;
  completed: number;
  total: number;
  statusType: 'dispute' | 'ready' | 'pending';
  statusLabel: string;
  updatedInfo: string;
  tag: string;
  onPress?: () => void;
}

export const InspectionCard: React.FC<InspectionCardProps> = ({
  code,
  title,
  location,
  completed,
  total,
  statusType,
  statusLabel,
  updatedInfo,
  tag,
  onPress,
}) => {
  const percentage = Math.round((completed / total) * 100);

  const getThemeByStatus = () => {
    switch (statusType) {
      case 'dispute':
        return {
          stripeColor: FieldMeshColors.tertiaryContainer,
          badgeBg: FieldMeshColors.tertiaryFixed,
          badgeText: FieldMeshColors.onTertiaryFixed,
          iconName: 'warning',
          progressColor: FieldMeshColors.primaryContainer,
        };
      case 'ready':
        return {
          stripeColor: FieldMeshColors.secondary,
          badgeBg: FieldMeshColors.secondaryContainer,
          badgeText: FieldMeshColors.onSecondaryContainer,
          iconName: 'cloud_queue',
          progressColor: FieldMeshColors.secondary,
        };
      case 'pending':
      default:
        return {
          stripeColor: FieldMeshColors.outlineVariant,
          badgeBg: FieldMeshColors.surfaceContainerHigh,
          badgeText: FieldMeshColors.onSurfaceVariant,
          iconName: 'schedule',
          progressColor: FieldMeshColors.outlineVariant,
        };
    }
  };

  const theme = getThemeByStatus();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {/* 6px Left Vertical Status Stripe */}
      <View style={[styles.statusStripe, { backgroundColor: theme.stripeColor }]} />

      <View style={styles.cardContent}>
        {/* Top Meta Row */}
        <View style={styles.topRow}>
          <View style={styles.headerLeft}>
            <View style={styles.badgeRow}>
              <Text style={styles.codeText}>{code}</Text>
              <View style={[styles.statusBadge, { backgroundColor: theme.badgeBg }]}>
                <FieldMeshIcon name={theme.iconName} size={13} color={theme.badgeText} />
                <Text style={[styles.statusBadgeText, { color: theme.badgeText }]}>
                  {statusLabel}
                </Text>
              </View>
            </View>
            <Text style={styles.titleText}>{title}</Text>
            <Text style={styles.locationText}>{location}</Text>
          </View>
          <FieldMeshIcon name="chevron_right" size={24} color={FieldMeshColors.onSurfaceVariant} />
        </View>

        {/* Progress Bar & Counter */}
        <View style={styles.progressContainer}>
          <View style={styles.progressMeta}>
            <Text style={styles.progressCountText}>
              {completed} / {total} completed
            </Text>
            <Text style={[styles.percentageText, { color: theme.progressColor }]}>
              {percentage}%
            </Text>
          </View>
          <View style={styles.progressBarTrack}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${percentage}%`, backgroundColor: theme.progressColor },
              ]}
            />
          </View>
        </View>

        {/* Footer info row */}
        <View style={styles.footerRow}>
          <View style={styles.footerLeft}>
            <FieldMeshIcon name="schedule" size={14} color={FieldMeshColors.onSurfaceVariant} />
            <Text style={styles.footerText}>{updatedInfo}</Text>
          </View>
          <View style={styles.tagBadge}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: FieldMeshColors.surfaceLowest,
    borderRadius: FieldMeshRadius.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    borderWidth: 1,
    borderColor: FieldMeshColors.surfaceContainerHigh,
    flexDirection: 'row',
  },
  cardPressed: {
    opacity: 0.96,
    transform: [{ scale: 0.995 }],
  },
  statusStripe: {
    width: 6,
    height: '100%',
  },
  cardContent: {
    flex: 1,
    padding: FieldMeshSpacing.md,
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flex: 1,
    paddingRight: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: FieldMeshColors.onSurfaceVariant,
    letterSpacing: 0.5,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: FieldMeshRadius.full,
    gap: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  titleText: {
    fontSize: 16,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
    lineHeight: 22,
  },
  locationText: {
    fontSize: 13,
    fontWeight: '500',
    color: FieldMeshColors.onSurfaceVariant,
    marginTop: 2,
  },
  progressContainer: {
    gap: 6,
  },
  progressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressCountText: {
    fontSize: 13,
    fontWeight: '600',
    color: FieldMeshColors.onSurface,
  },
  percentageText: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
  },
  progressBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: FieldMeshColors.surfaceContainerLow,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  footerText: {
    fontSize: 12,
    color: FieldMeshColors.onSurfaceVariant,
    fontWeight: '500',
  },
  tagBadge: {
    backgroundColor: FieldMeshColors.surfaceContainer,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: FieldMeshRadius.xs,
  },
  tagText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: FieldMeshColors.onSurfaceVariant,
    textTransform: 'uppercase',
  },
});
