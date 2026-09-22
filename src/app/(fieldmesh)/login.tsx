import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// FieldMesh Brand Logo with Connected Network Nodes
function FieldMeshLogo() {
  return (
    <View style={styles.logoContainer}>
      <View style={styles.logoBox}>
        {/* Network Nodes and Connectors */}
        <View style={styles.meshGraphic}>
          {/* Connector Lines */}
          <View style={styles.lineDiagonalLeft} />
          <View style={styles.lineDiagonalRight} />
          <View style={styles.lineHorizontal} />

          {/* Top Node (Indigo) */}
          <View style={[styles.nodeDot, styles.topNode]} />
          {/* Bottom Left Node (Purple) */}
          <View style={[styles.nodeDot, styles.bottomLeftNode]} />
          {/* Bottom Right Node (Green - Mesh indicator) */}
          <View style={[styles.nodeDot, styles.bottomRightNode]} />
          {/* Center Hub */}
          <View style={[styles.nodeDot, styles.centerHub]} />
        </View>
      </View>
    </View>
  );
}

// Background Dot Grid Pattern
function DottedGridBackground() {
  const dotsAcross = Math.ceil(SCREEN_WIDTH / 24);
  const rows = 36;

  return (
    <View style={styles.dotGridContainer} pointerEvents="none">
      {Array.from({ length: rows }).map((_, rIdx) => (
        <View key={`row-${rIdx}`} style={styles.dotRow}>
          {Array.from({ length: dotsAcross }).map((_, cIdx) => (
            <View key={`dot-${rIdx}-${cIdx}`} style={styles.dotItem} />
          ))}
        </View>
      ))}
    </View>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('alex.m@fieldmesh.io');
  const [fullName, setFullName] = useState('Alex Mercer');
  const [operatorId, setOperatorId] = useState('OP-4091');
  const [password, setPassword] = useState('fieldsecret4091');
  const [showPassword, setShowPassword] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleSignIn = () => {
    setIsAuthenticating(true);
    setTimeout(() => {
      setIsAuthenticating(false);
      router.replace('/inspections');
    }, 450);
  };

  const handleBiometricUnlock = () => {
    Alert.alert(
      'Biometric Unlock',
      'Verifying operator credentials via Face ID / Fingerprint...',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Authenticate',
          onPress: () => {
            setIsAuthenticating(true);
            setTimeout(() => {
              setIsAuthenticating(false);
              router.replace('/inspections');
            }, 300);
          },
        },
      ]
    );
  };

  const handleNeedHelp = () => {
    Alert.alert(
      'Need Access Assistance?',
      'Choose a recovery method for offline field operations:\n\n• Supervisor NFC Authorization\n• Local Mesh PIN Reset\n• Offline Emergency Bypass',
      [{ text: 'OK' }]
    );
  };

  const handleCreateAccount = () => {
    setActiveTab('signup');
  };

  const handleStatusInfo = () => {
    Alert.alert(
      'Mesh Status: Offline Ready',
      '• 4 nearby FieldMesh nodes active\n• AES-256 local ledger active\n• Zero cellular data required',
      [{ text: 'Dismiss' }]
    );
  };

  return (
    <View style={styles.screen}>
      <DottedGridBackground />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top, 16) + 6,
            paddingBottom: Math.max(insets.bottom, 16) + 24,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. TOP STATUS PILL */}
        <Pressable
          onPress={handleStatusInfo}
          style={({ pressed }) => [styles.statusPill, pressed && styles.pressedLight]}
        >
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Offline ready • 4 nearby nodes</Text>
          <FieldMeshIcon name="info_outline" size={15} color="#94a3b8" />
        </Pressable>

        {/* 2. BRAND SECTION */}
        <View style={styles.brandSection}>
          <FieldMeshLogo />

          <View style={styles.brandTitleRow}>
            <Text style={styles.brandTextField}>FIELD</Text>
            <Text style={styles.brandTextMesh}>MESH</Text>
          </View>

          <Text style={styles.subBrandText}>OFFLINE FIELD OPS</Text>
          <Text style={styles.taglineText}>Field operations, always connected.</Text>
        </View>

        {/* 3. LOGIN CARD */}
        <View style={styles.card}>
          {/* Sign In / Sign Up Tabs */}
          <View style={styles.tabContainer}>
            <Pressable
              onPress={() => setActiveTab('signin')}
              style={[styles.tabButton, activeTab === 'signin' && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'signin' ? styles.tabTextActive : styles.tabTextInactive,
                ]}
              >
                Sign In
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setActiveTab('signup')}
              style={[styles.tabButton, activeTab === 'signup' && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'signup' ? styles.tabTextActive : styles.tabTextInactive,
                ]}
              >
                Sign Up
              </Text>
            </Pressable>
          </View>

          {activeTab === 'signin' ? (
            <>
              {/* One-Tap Biometric Unlock Button */}
              <Pressable
                onPress={handleBiometricUnlock}
                style={({ pressed }) => [
                  styles.biometricCard,
                  pressed && styles.biometricCardPressed,
                ]}
              >
                <View style={styles.biometricIconCircle}>
                  <FieldMeshIcon name="fingerprint" size={24} color="#7c3aed" />
                </View>

                <View style={styles.biometricTextGroup}>
                  <Text style={styles.biometricTitle}>One-Tap Biometric Unlock</Text>
                  <Text style={styles.biometricSubtitle}>
                    Instant sign in via Face ID or Touch
                  </Text>
                </View>

                <FieldMeshIcon name="arrow_forward" size={18} color="#7c3aed" />
              </Pressable>

              {/* Divider: OR CONTINUE WITH */}
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Email / Operator ID Field */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Work Email or Operator ID</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="name@fieldmesh.io"
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                  />
                  <FieldMeshIcon name="mail_outline" size={19} color="#94a3b8" />
                </View>
              </View>

              {/* Password Field */}
              <View style={styles.fieldGroup}>
                <View style={styles.passwordLabelRow}>
                  <Text style={styles.fieldLabel}>Password or Field PIN</Text>
                  <Pressable onPress={handleNeedHelp} hitSlop={8}>
                    <Text style={styles.needHelpText}>Need help?</Text>
                  </Pressable>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Enter password or PIN"
                    placeholderTextColor="#94a3b8"
                    secureTextEntry={!showPassword}
                  />
                  <Pressable
                    onPress={() => setShowPassword(!showPassword)}
                    hitSlop={8}
                    style={styles.visibilityToggle}
                  >
                    <FieldMeshIcon
                      name={showPassword ? 'visibility_off' : 'visibility'}
                      size={20}
                      color="#94a3b8"
                    />
                  </Pressable>
                </View>
              </View>

              {/* Primary Sign In Button */}
              <Pressable
                onPress={handleSignIn}
                disabled={isAuthenticating}
                style={({ pressed }) => [
                  styles.signInButton,
                  pressed && styles.signInButtonPressed,
                ]}
              >
                <Text style={styles.signInButtonText}>
                  {isAuthenticating ? 'Signing In...' : 'Sign In'}
                </Text>
                <FieldMeshIcon name="arrow_forward" size={18} color="#ffffff" />
              </Pressable>

              {/* Create Account Helper Row */}
              <View style={styles.accountRow}>
                <Text style={styles.newTechText}>New field technician? </Text>
                <Pressable onPress={handleCreateAccount} hitSlop={6}>
                  <Text style={styles.createAccountText}>Create account</Text>
                </Pressable>
              </View>
            </>
          ) : (
            /* Sign Up View */
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Full Operator Name</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder="Alex Mercer"
                    placeholderTextColor="#94a3b8"
                  />
                  <FieldMeshIcon name="person" size={19} color="#94a3b8" />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Operator Badge ID</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    value={operatorId}
                    onChangeText={setOperatorId}
                    placeholder="OP-4091"
                    placeholderTextColor="#94a3b8"
                  />
                  <FieldMeshIcon name="badge" size={19} color="#94a3b8" />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Work Email</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="alex.m@fieldmesh.io"
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="none"
                  />
                  <FieldMeshIcon name="mail_outline" size={19} color="#94a3b8" />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Create 6-Digit Field PIN</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••"
                    placeholderTextColor="#94a3b8"
                    secureTextEntry={!showPassword}
                  />
                  <Pressable
                    onPress={() => setShowPassword(!showPassword)}
                    hitSlop={8}
                    style={styles.visibilityToggle}
                  >
                    <FieldMeshIcon
                      name={showPassword ? 'visibility_off' : 'visibility'}
                      size={20}
                      color="#94a3b8"
                    />
                  </Pressable>
                </View>
              </View>

              <Pressable
                onPress={handleSignIn}
                disabled={isAuthenticating}
                style={({ pressed }) => [
                  styles.signInButton,
                  pressed && styles.signInButtonPressed,
                ]}
              >
                <Text style={styles.signInButtonText}>
                  {isAuthenticating ? 'Creating Account...' : 'Create Operator Account'}
                </Text>
                <FieldMeshIcon name="arrow_forward" size={18} color="#ffffff" />
              </Pressable>

              <View style={styles.accountRow}>
                <Text style={styles.newTechText}>Already registered? </Text>
                <Pressable onPress={() => setActiveTab('signin')} hitSlop={6}>
                  <Text style={styles.createAccountText}>Sign In</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>

        {/* 4. SECURITY FOOTER */}
        <View style={styles.securityFooter}>
          <FieldMeshIcon name="lock" size={13} color="#94a3b8" />
          <Text style={styles.securityFooterText}>End-to-end encrypted local mesh</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f5f6fa',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    alignItems: 'center',
  },

  /* Background Dotted Grid */
  dotGridContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.35,
    overflow: 'hidden',
  },
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 24,
    alignItems: 'center',
  },
  dotItem: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#94a3b8',
  },

  /* Top Status Pill */
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    marginBottom: 16,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#22c55e',
    marginRight: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginRight: 8,
    letterSpacing: 0.2,
  },

  /* Brand Section */
  brandSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoContainer: {
    marginBottom: 12,
  },
  logoBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  meshGraphic: {
    width: 28,
    height: 28,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineDiagonalLeft: {
    position: 'absolute',
    top: 5,
    left: 4,
    width: 13,
    height: 1.5,
    backgroundColor: 'rgba(165, 180, 252, 0.55)',
    transform: [{ rotate: '55deg' }],
  },
  lineDiagonalRight: {
    position: 'absolute',
    top: 5,
    right: 4,
    width: 13,
    height: 1.5,
    backgroundColor: 'rgba(165, 180, 252, 0.55)',
    transform: [{ rotate: '-55deg' }],
  },
  lineHorizontal: {
    position: 'absolute',
    bottom: 4,
    left: 5,
    right: 5,
    height: 1.5,
    backgroundColor: 'rgba(165, 180, 252, 0.45)',
  },
  nodeDot: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  topNode: {
    top: 1,
    alignSelf: 'center',
    backgroundColor: '#818cf8',
  },
  bottomLeftNode: {
    bottom: 1,
    left: 2,
    backgroundColor: '#a855f7',
  },
  bottomRightNode: {
    bottom: 1,
    right: 2,
    backgroundColor: '#22c55e',
  },
  centerHub: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#6366f1',
    top: 11,
    alignSelf: 'center',
  },
  brandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandTextField: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: 1.2,
  },
  brandTextMesh: {
    fontSize: 24,
    fontWeight: '800',
    color: '#7c3aed',
    letterSpacing: 1.2,
  },
  subBrandText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 2,
    marginTop: 3,
    textTransform: 'uppercase',
  },
  taglineText: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
    fontWeight: '400',
  },

  /* Main Card */
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: '#e8edf5',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 4,
    gap: 15,
  },

  /* Tabs */
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  tabText: {
    fontSize: 14,
  },
  tabTextActive: {
    fontWeight: '700',
    color: '#0f172a',
  },
  tabTextInactive: {
    fontWeight: '500',
    color: '#64748b',
  },

  /* Biometric Unlock Card */
  biometricCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fbf9ff',
    borderWidth: 1,
    borderColor: '#ede9fe',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  biometricCardPressed: {
    backgroundColor: '#f3e8ff',
    transform: [{ scale: 0.99 }],
  },
  biometricIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ede9fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  biometricTextGroup: {
    flex: 1,
  },
  biometricTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.1,
  },
  biometricSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },

  /* Divider */
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  dividerText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1,
    paddingHorizontal: 10,
    textTransform: 'uppercase',
  },

  /* Fields */
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  passwordLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  needHelpText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7c3aed',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 14,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    height: '100%',
  },
  visibilityToggle: {
    padding: 4,
  },

  /* Primary Button */
  signInButton: {
    height: 50,
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  signInButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  signInButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.2,
  },

  /* Create Account Row */
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 4,
  },
  newTechText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  createAccountText: {
    fontSize: 13,
    color: '#7c3aed',
    fontWeight: '700',
  },

  /* Security Footer */
  securityFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    gap: 6,
  },
  securityFooterText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
  },

  pressedLight: {
    opacity: 0.8,
  },
});
