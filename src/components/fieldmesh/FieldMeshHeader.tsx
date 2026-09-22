import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshIcon } from './FieldMeshIcon';
import { SyncStatusPill, SyncStatusPillProps } from './SyncStatusPill';

interface FieldMeshHeaderProps {
  title: string;
  category?: string;
  showBack?: boolean;
  onBackPress?: () => void;
  statusBadge?: {
    label: string;
    variant?: SyncStatusPillProps['variant'];
  };
  rightAction?: React.ReactNode;
}

export const FieldMeshHeader: React.FC<FieldMeshHeaderProps> = ({
  title,
  category = 'FIELDMESH',
  showBack = false,
  onBackPress,
  statusBadge = { label: 'Saved on phone', variant: 'offline' },
  rightAction,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleBack = () => {
    if (onBackPress) {
      onBackPress();
    } else if (router.canGoBack()) {
      router.back();
    }
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) + 6 }]}>
      <View style={styles.contentRow}>
        <View style={styles.leftSection}>
          {showBack && (
            <Pressable
              onPress={handleBack}
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
              hitSlop={8}
            >
              <FieldMeshIcon name="arrow_back" size={24} color={FieldMeshColors.onSurface} />
            </Pressable>
          )}
          <View style={styles.titleColumn}>
            {category ? <Text style={styles.categoryText}>{category}</Text> : null}
            <Text style={styles.titleText} numberOfLines={1}>
              {title}
            </Text>
          </View>
        </View>

        <View style={styles.rightSection}>
          {statusBadge && (
            <SyncStatusPill label={statusBadge.label} variant={statusBadge.variant} />
          )}
          {rightAction ? (
            rightAction
          ) : (
            <View style={styles.avatar}>
              <FieldMeshIcon name="person" size={18} color={FieldMeshColors.onPrimary} />
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: FieldMeshColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: FieldMeshColors.surfaceContainerHigh,
    paddingHorizontal: FieldMeshSpacing.gutter,
    paddingBottom: 12,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: FieldMeshRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -4,
  },
  backButtonPressed: {
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
  },
  titleColumn: {
    flex: 1,
    justifyContent: 'center',
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '700',
    color: FieldMeshColors.onSurfaceVariant,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  titleText: {
    fontSize: 18,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
    letterSpacing: -0.2,
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: FieldMeshColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
