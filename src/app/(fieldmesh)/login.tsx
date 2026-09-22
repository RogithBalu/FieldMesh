import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [workId, setWorkId] = useState('tech.4820@gridpower.com');
  const [authKey, setAuthKey] = useState('fieldsecure8891');
  const [showPassword, setShowPassword] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [offlineShift, setOfflineShift] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleLogin = () => {
    setIsSigningIn(true);
    setTimeout(() => {
      setIsSigningIn(false);
      router.replace('/inspections');
    }, 400);
  };

  const handleNfcTap = () => {
    Alert.alert('NFC Reader Active', 'Hold technician keycard or hardware token to device.');
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top, 20) + 10, paddingBottom: insets.bottom + 30 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Status Bar */}
        <View style={styles.topStatusRow}>
          <View style={styles.systemReadyPill}>
            <View style={styles.greenDot} />
            <Text style={styles.systemReadyText}>SYSTEM READY (OFFLINE)</Text>
          </View>
          <View style={styles.cryptoBadge}>
            <FieldMeshIcon name="lock" size={14} color={FieldMeshColors.onSurfaceVariant} />
            <Text style={styles.cryptoText}>AES-256</Text>
          </View>
        </View>

        {/* Brand & Platform Intro */}
        <View style={styles.brandSection}>
          <View style={styles.brandTitleRow}>
            <FieldMeshIcon name="bolt" size={32} color={FieldMeshColors.primary} />
            <Text style={styles.brandTitle}>FieldMesh</Text>
          </View>

          <View style={styles.platformBadge}>
            <FieldMeshIcon name="verified_user" size={15} color={FieldMeshColors.primary} />
            <Text style={styles.platformBadgeText}>Industrial Offline Inspection Platform</Text>
          </View>

          <Text style={styles.brandSubtitle}>
            Field verification & asset telemetry workspace. High-lux contrast mode enabled.
          </Text>
        </View>

        {/* Form Card */}
        <View style={styles.formCard}>
          {/* Work ID / Email */}
          <View style={styles.inputGroup}>
            <View style={styles.labelRow}>
              <View style={styles.labelLeft}>
                <FieldMeshIcon name="badge" size={16} color={FieldMeshColors.primary} />
                <Text style={styles.labelText}>Work Email or Badge ID</Text>
              </View>
              <Text style={styles.tagLabel}>SEC-ID</Text>
            </View>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                value={workId}
                onChangeText={setWorkId}
                autoCapitalize="none"
                placeholder="technician@gridpower.com"
                placeholderTextColor={FieldMeshColors.outline}
              />
              <View style={styles.inputRightIcon}>
                <FieldMeshIcon name="check_circle" size={18} color={FieldMeshColors.secondary} />
              </View>
            </View>
          </View>

          {/* Password or PIN */}
          <View style={styles.inputGroup}>
            <View style={styles.labelRow}>
              <View style={styles.labelLeft}>
                <FieldMeshIcon name="dialpad" size={16} color={FieldMeshColors.primary} />
                <Text style={styles.labelText}>
                  {pinMode ? '6-Digit Rugged PIN' : 'Password or Rugged PIN'}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setPinMode(!pinMode);
                  setAuthKey(pinMode ? 'fieldsecure8891' : '889142');
                }}
              >
                <Text style={styles.switchModeLink}>
                  {pinMode ? 'Switch to Password' : 'Switch to 6-Digit PIN'}
                </Text>
              </Pressable>
            </View>
            <View style={styles.inputWrapper}>
              <TextInput
                style={[styles.input, { fontFamily: 'monospace', letterSpacing: 1.5 }]}
                value={authKey}
                onChangeText={setAuthKey}
                secureTextEntry={!showPassword}
                keyboardType={pinMode ? 'numeric' : 'default'}
                placeholder={pinMode ? '0 0 0 0 0 0' : '••••••••••••'}
                placeholderTextColor={FieldMeshColors.outline}
              />
              <Pressable
                onPress={() => setShowPassword(!showPassword)}
                style={styles.inputRightIcon}
              >
                <FieldMeshIcon
                  name={showPassword ? 'visibility_off' : 'visibility'}
                  size={20}
                  color={FieldMeshColors.onSurfaceVariant}
                />
              </Pressable>
            </View>
          </View>

          {/* Offline Shift Checkbox */}
          <Pressable
            onPress={() => setOfflineShift(!offlineShift)}
            style={styles.offlineShiftCard}
          >
            <View
              style={[styles.checkbox, offlineShift ? styles.checkboxChecked : styles.checkboxUnchecked]}
            >
              {offlineShift && (
                <FieldMeshIcon name="check" size={14} color={FieldMeshColors.onPrimary} />
              )}
            </View>
            <View style={styles.offlineShiftContent}>
              <View style={styles.offlineShiftHeader}>
                <Text style={styles.offlineShiftTitle}>Stay signed in for offline shifts</Text>
                <View style={styles.localKeyBadge}>
                  <Text style={styles.localKeyText}>LOCAL KEY</Text>
                </View>
              </View>
              <Text style={styles.offlineShiftSub}>
                Terminal authenticated offline for 30 days without remote sync.
              </Text>
            </View>
          </Pressable>

          {/* Sign In Primary Action */}
          <Pressable
            onPress={handleLogin}
            disabled={isSigningIn}
            style={({ pressed }) => [styles.signInBtn, pressed && styles.btnPressed]}
          >
            <FieldMeshIcon
              name={isSigningIn ? 'sync' : 'login'}
              size={20}
              color={FieldMeshColors.onPrimary}
            />
            <Text style={styles.signInBtnText}>
              {isSigningIn ? 'Authenticating Offline Vault...' : 'Sign In to Terminal'}
            </Text>
          </Pressable>

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR RAPID FIELD TAP</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* NFC Badge Tap */}
          <Pressable
            onPress={handleNfcTap}
            style={({ pressed }) => [styles.nfcBtn, pressed && styles.btnPressed]}
          >
            <FieldMeshIcon name="contactless" size={22} color={FieldMeshColors.primary} />
            <Text style={styles.nfcBtnText}>Tap NFC Badge or Scan Keycard</Text>
          </Pressable>
        </View>

        {/* Device Vault Readiness Status */}
        <View style={styles.vaultReadiness}>
          <View style={styles.vaultRow}>
            <View style={styles.greenDot} />
            <Text style={styles.vaultText}>FieldMesh Client v2.4.1 · Offline Vault Active</Text>
          </View>
          <Text style={styles.hardwareText}>
            Hardware ID: <Text style={styles.hardwareId}>GRID-PANEL-883A</Text> · Zero Internet Required
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
    gap: FieldMeshSpacing.lg,
  },
  topStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  systemReadyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: FieldMeshColors.surfaceContainer,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: FieldMeshRadius.full,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: FieldMeshColors.secondary,
  },
  systemReadyText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: FieldMeshColors.onSurfaceVariant,
    letterSpacing: 0.5,
  },
  cryptoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cryptoText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: FieldMeshColors.onSurfaceVariant,
    fontWeight: '600',
  },
  brandSection: {
    alignItems: 'center',
    gap: 8,
  },
  brandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: FieldMeshColors.primary,
    letterSpacing: -0.5,
  },
  platformBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: FieldMeshRadius.sm,
  },
  platformBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  brandSubtitle: {
    fontSize: 13,
    color: FieldMeshColors.onSurfaceVariant,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 18,
  },
  formCard: {
    backgroundColor: FieldMeshColors.surfaceLowest,
    borderRadius: FieldMeshRadius.xl,
    padding: FieldMeshSpacing.md,
    borderWidth: 1,
    borderColor: FieldMeshColors.surfaceContainerHigh,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 3,
    gap: 14,
  },
  inputGroup: {
    gap: 6,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  labelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  labelText: {
    fontSize: 13,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  tagLabel: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: FieldMeshColors.onSurfaceVariant,
  },
  switchModeLink: {
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.primary,
    textDecorationLine: 'underline',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    borderRadius: FieldMeshRadius.md,
    paddingHorizontal: 12,
    height: 52,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: FieldMeshColors.onSurface,
    height: '100%',
  },
  inputRightIcon: {
    padding: 4,
  },
  offlineShiftCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    padding: 10,
    borderRadius: FieldMeshRadius.md,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: FieldMeshColors.primaryContainer,
  },
  checkboxUnchecked: {
    borderWidth: 1.5,
    borderColor: FieldMeshColors.outline,
    backgroundColor: FieldMeshColors.surfaceLowest,
  },
  offlineShiftContent: {
    flex: 1,
  },
  offlineShiftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  offlineShiftTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  localKeyBadge: {
    backgroundColor: FieldMeshColors.secondaryContainer,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  localKeyText: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: FieldMeshColors.onSecondaryContainer,
  },
  offlineShiftSub: {
    fontSize: 11,
    color: FieldMeshColors.onSurfaceVariant,
    marginTop: 2,
    lineHeight: 15,
  },
  signInBtn: {
    height: 52,
    borderRadius: FieldMeshRadius.lg,
    backgroundColor: FieldMeshColors.primaryContainer,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  signInBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: FieldMeshColors.onPrimary,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 2,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
  },
  dividerText: {
    fontSize: 10,
    fontWeight: '700',
    color: FieldMeshColors.onSurfaceVariant,
    letterSpacing: 0.5,
  },
  nfcBtn: {
    height: 52,
    borderRadius: FieldMeshRadius.lg,
    backgroundColor: FieldMeshColors.surfaceContainer,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nfcBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  vaultReadiness: {
    alignItems: 'center',
    gap: 4,
    paddingTop: 8,
  },
  vaultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  vaultText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: FieldMeshColors.onSurfaceVariant,
  },
  hardwareText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: FieldMeshColors.outline,
  },
  hardwareId: {
    color: FieldMeshColors.onSurface,
    fontWeight: '700',
  },
  btnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
});
