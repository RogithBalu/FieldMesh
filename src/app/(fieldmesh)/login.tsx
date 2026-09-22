import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { FieldMeshColors } from '@/constants/fieldMeshTheme';
import { useAuth } from '@/lib/auth-context';
import { api, errorMessage, type Role } from '@/lib/api';
import { describeServer, onServerConfigChange } from '@/lib/config';
import { ONBOARDED_KEY } from '@/constants/storageKeys';

function FieldMeshLogo() {
  return (
    <View style={styles.logoContainer}>
      <View style={styles.logoBox}>
        <View style={styles.meshGraphic}>
          <View style={styles.lineDiagonalLeft} />
          <View style={styles.lineDiagonalRight} />
          <View style={styles.lineHorizontal} />
          <View style={[styles.nodeDot, styles.topNode]} />
          <View style={[styles.nodeDot, styles.bottomLeftNode]} />
          <View style={[styles.nodeDot, styles.bottomRightNode]} />
          <View style={[styles.nodeDot, styles.centerHub]} />
        </View>
      </View>
    </View>
  );
}

const ROLES: { value: Role; label: string }[] = [
  { value: 'technician', label: 'Technician' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'auditor', label: 'Auditor' },
];

type ServerState = 'checking' | 'online' | 'offline';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { login, signup } = useAuth();

  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('technician');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverState, setServerState] = useState<ServerState>('checking');
  const [serverHost, setServerHost] = useState(describeServer().apiUrl);

  // GET /health — tells the operator whether the server is reachable before they try to sign in.
  const checkServer = useCallback(async () => {
    let ok = false;
    try {
      ok = (await api.health()).ok;
    } catch {
      ok = false;
    }
    setServerHost(describeServer().apiUrl);
    setServerState(ok ? 'online' : 'offline');
  }, []);

  const recheckServer = () => {
    setServerState('checking');
    checkServer();
  };

  useEffect(() => {
    // Kick off the first check from a microtask so state updates land in a callback, not the effect body.
    Promise.resolve().then(checkServer);
    return onServerConfigChange(checkServer);
  }, [checkServer]);

  const goIn = async (freshAccount: boolean) => {
    const onboarded = await AsyncStorage.getItem(ONBOARDED_KEY);
    if (freshAccount && !onboarded) router.replace('/(fieldmesh)/onboarding');
    else router.replace('/(fieldmesh)/inspections');
  };

  const handleSignIn = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      await login(email, password);
      await goIn(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSignUp = async () => {
    setError(null);
    if (!fullName.trim() || !email.trim() || !password) {
      setError('Fill in name, email, and password.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await signup({ email, name: fullName, password, role });
      await goIn(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const serverLabel =
    serverState === 'checking'
      ? 'Checking server…'
      : serverState === 'online'
        ? `Server online · ${serverHost.replace(/^https?:\/\//, '')}`
        : `Server unreachable · ${serverHost.replace(/^https?:\/\//, '')}`;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top, 16) + 6, paddingBottom: Math.max(insets.bottom, 16) + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Server status pill — tap to change server (Mesh screen) */}
        <Pressable
          onPress={() => router.push('/(fieldmesh)/mesh')}
          onLongPress={recheckServer}
          style={({ pressed }) => [styles.statusPill, pressed && styles.pressedLight]}
        >
          <View
            style={[
              styles.statusDot,
              serverState === 'online' && styles.statusDotOnline,
              serverState === 'offline' && styles.statusDotOffline,
            ]}
          />
          <Text style={styles.statusText} numberOfLines={1}>
            {serverLabel}
          </Text>
          <FieldMeshIcon name="settings" size={15} color="#94a3b8" />
        </Pressable>

        <View style={styles.brandSection}>
          <FieldMeshLogo />
          <View style={styles.brandTitleRow}>
            <Text style={styles.brandTextField}>FIELD</Text>
            <Text style={styles.brandTextMesh}>MESH</Text>
          </View>
          <Text style={styles.subBrandText}>OFFLINE FIELD OPS</Text>
          <Text style={styles.taglineText}>Sign in to sync inspections with your team.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.tabContainer}>
            {(['signin', 'signup'] as const).map((tab) => (
              <Pressable
                key={tab}
                onPress={() => {
                  setActiveTab(tab);
                  setError(null);
                }}
                style={[styles.tabButton, activeTab === tab && styles.tabActive]}
              >
                <Text style={[styles.tabText, activeTab === tab ? styles.tabTextActive : styles.tabTextInactive]}>
                  {tab === 'signin' ? 'Sign In' : 'Sign Up'}
                </Text>
              </Pressable>
            ))}
          </View>

          {activeTab === 'signup' && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Full Operator Name</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.textInput}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Alex Mercer"
                  placeholderTextColor="#94a3b8"
                  autoComplete="name"
                  testID="login-name"
                />
                <FieldMeshIcon name="person" size={19} color="#94a3b8" />
              </View>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Work Email</Text>
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
                autoComplete="email"
                testID="login-email"
              />
              <FieldMeshIcon name="mail_outline" size={19} color="#94a3b8" />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <View style={styles.passwordLabelRow}>
              <Text style={styles.fieldLabel}>{activeTab === 'signin' ? 'Password' : 'Password (min. 8 characters)'}</Text>
              {activeTab === 'signin' && (
                <Pressable onPress={() => router.push('/(fieldmesh)/mesh')} hitSlop={8}>
                  <Text style={styles.needHelpText}>Server settings</Text>
                </Pressable>
              )}
            </View>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.textInput}
                value={password}
                onChangeText={setPassword}
                placeholder={activeTab === 'signin' ? 'Enter password' : 'Choose a password'}
                placeholderTextColor="#94a3b8"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                testID="login-password"
                onSubmitEditing={activeTab === 'signin' ? handleSignIn : undefined}
              />
              <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={8} style={styles.visibilityToggle}>
                <FieldMeshIcon name={showPassword ? 'visibility_off' : 'visibility'} size={20} color="#94a3b8" />
              </Pressable>
            </View>
          </View>

          {activeTab === 'signup' && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Role</Text>
              <View style={styles.roleRow}>
                {ROLES.map((r) => (
                  <Pressable
                    key={r.value}
                    onPress={() => setRole(r.value)}
                    style={[styles.rolePill, role === r.value && styles.rolePillActive]}
                  >
                    <Text style={[styles.rolePillText, role === r.value && styles.rolePillTextActive]}>{r.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.roleHint}>Supervisors and auditors sign off disputed safety items.</Text>
            </View>
          )}

          {error && (
            <View style={styles.errorBox}>
              <FieldMeshIcon name="warning" size={16} color={FieldMeshColors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={activeTab === 'signin' ? handleSignIn : handleSignUp}
            disabled={busy}
            testID="login-submit"
            style={({ pressed }) => [styles.signInButton, pressed && styles.signInButtonPressed, busy && { opacity: 0.8 }]}
          >
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Text style={styles.signInButtonText}>{activeTab === 'signin' ? 'Sign In' : 'Create Operator Account'}</Text>
                <FieldMeshIcon name="arrow_forward" size={18} color="#ffffff" />
              </>
            )}
          </Pressable>

          <View style={styles.accountRow}>
            <Text style={styles.newTechText}>{activeTab === 'signin' ? 'New field technician? ' : 'Already registered? '}</Text>
            <Pressable
              onPress={() => {
                setActiveTab(activeTab === 'signin' ? 'signup' : 'signin');
                setError(null);
              }}
              hitSlop={6}
            >
              <Text style={styles.createAccountText}>{activeTab === 'signin' ? 'Create account' : 'Sign In'}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.securityFooter}>
          <FieldMeshIcon name="lock" size={13} color="#94a3b8" />
          <Text style={styles.securityFooterText}>Passwords hashed with scrypt on the server · JWT sessions</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f6fa' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, alignItems: 'center' },
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
    maxWidth: '100%',
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#94a3b8', marginRight: 8 },
  statusDotOnline: { backgroundColor: '#22c55e' },
  statusDotOffline: { backgroundColor: '#ef4444' },
  statusText: { fontSize: 12, fontWeight: '600', color: '#334155', marginRight: 8, letterSpacing: 0.2, flexShrink: 1 },
  brandSection: { alignItems: 'center', marginBottom: 20 },
  logoContainer: { marginBottom: 12 },
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
  meshGraphic: { width: 28, height: 28, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  lineDiagonalLeft: { position: 'absolute', top: 5, left: 4, width: 13, height: 1.5, backgroundColor: 'rgba(165, 180, 252, 0.55)', transform: [{ rotate: '55deg' }] },
  lineDiagonalRight: { position: 'absolute', top: 5, right: 4, width: 13, height: 1.5, backgroundColor: 'rgba(165, 180, 252, 0.55)', transform: [{ rotate: '-55deg' }] },
  lineHorizontal: { position: 'absolute', bottom: 4, left: 5, right: 5, height: 1.5, backgroundColor: 'rgba(165, 180, 252, 0.45)' },
  nodeDot: { position: 'absolute', width: 7, height: 7, borderRadius: 3.5 },
  topNode: { top: 1, alignSelf: 'center', backgroundColor: '#818cf8' },
  bottomLeftNode: { bottom: 1, left: 2, backgroundColor: '#a855f7' },
  bottomRightNode: { bottom: 1, right: 2, backgroundColor: '#22c55e' },
  centerHub: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#6366f1', top: 11, alignSelf: 'center' },
  brandTitleRow: { flexDirection: 'row', alignItems: 'center' },
  brandTextField: { fontSize: 24, fontWeight: '800', color: '#0f172a', letterSpacing: 1.2 },
  brandTextMesh: { fontSize: 24, fontWeight: '800', color: '#7c3aed', letterSpacing: 1.2 },
  subBrandText: { fontSize: 10, fontWeight: '700', color: '#64748b', letterSpacing: 2, marginTop: 3, textTransform: 'uppercase' },
  taglineText: { fontSize: 13, color: '#64748b', marginTop: 4, fontWeight: '400' },
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
  tabContainer: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 12, padding: 4 },
  tabButton: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: '#ffffff', shadowColor: '#000000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 1 },
  tabText: { fontSize: 14 },
  tabTextActive: { fontWeight: '700', color: '#0f172a' },
  tabTextInactive: { fontWeight: '500', color: '#64748b' },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#334155' },
  passwordLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  needHelpText: { fontSize: 12, fontWeight: '600', color: '#7c3aed' },
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
  textInput: { flex: 1, fontSize: 14, color: '#0f172a', height: '100%' },
  visibilityToggle: { padding: 4 },
  roleRow: { flexDirection: 'row', gap: 8 },
  rolePill: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  rolePillActive: { backgroundColor: '#ede9fe', borderColor: '#7c3aed' },
  rolePillText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  rolePillTextActive: { color: '#7c3aed' },
  roleHint: { fontSize: 11, color: '#94a3b8' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: FieldMeshColors.errorContainer, padding: 10, borderRadius: 10 },
  errorText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: FieldMeshColors.onErrorContainer },
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
  signInButtonPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  signInButtonText: { fontSize: 15, fontWeight: '700', color: '#ffffff', letterSpacing: 0.2 },
  accountRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingTop: 4 },
  newTechText: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  createAccountText: { fontSize: 13, color: '#7c3aed', fontWeight: '700' },
  securityFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 18, gap: 6 },
  securityFooterText: { fontSize: 12, fontWeight: '500', color: '#94a3b8' },
  pressedLight: { opacity: 0.8 },
});
