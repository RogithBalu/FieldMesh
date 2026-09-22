import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { FieldMeshColors } from '@/constants/fieldMeshTheme';
import { useAuth } from '@/lib/auth-context';
import { LocalDbError } from '@/lib/localdb';

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

const ROLES = [
  { value: 'technician', label: 'Technician' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'auditor', label: 'Auditor' },
] as const;

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { login, signup } = useAuth();

  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]['value']>('technician');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goIn = () => router.replace('/(fieldmesh)/inspections');

  const handleSignIn = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      await login(email.trim().toLowerCase(), password);
      goIn();
    } catch (e) {
      setError(e instanceof LocalDbError ? e.message : 'Something went wrong.');
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
    setBusy(true);
    try {
      await signup({ email: email.trim().toLowerCase(), name: fullName.trim(), password, role });
      goIn();
    } catch (e) {
      setError(e instanceof LocalDbError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top, 16) + 24,
            paddingBottom: Math.max(insets.bottom, 16) + 24,
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandSection}>
          <FieldMeshLogo />
          <View style={styles.brandTitleRow}>
            <Text style={styles.brandTextField}>FIELD</Text>
            <Text style={styles.brandTextMesh}>MESH</Text>
          </View>
          <Text style={styles.subBrandText}>FIELD INSPECTIONS</Text>
          <Text style={styles.taglineText}>Sign in to sync with your team.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.tabContainer}>
            <Pressable
              onPress={() => {
                setActiveTab('signin');
                setError(null);
              }}
              style={[styles.tabButton, activeTab === 'signin' && styles.tabActive]}
            >
              <Text style={[styles.tabText, activeTab === 'signin' ? styles.tabTextActive : styles.tabTextInactive]}>
                Sign In
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setActiveTab('signup');
                setError(null);
              }}
              style={[styles.tabButton, activeTab === 'signup' && styles.tabActive]}
            >
              <Text style={[styles.tabText, activeTab === 'signup' ? styles.tabTextActive : styles.tabTextInactive]}>
                Sign Up
              </Text>
            </Pressable>
          </View>

          {activeTab === 'signin' ? (
            <>
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
                  />
                  <FieldMeshIcon name="mail_outline" size={19} color="#94a3b8" />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Password</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Enter password"
                    placeholderTextColor="#94a3b8"
                    secureTextEntry={!showPassword}
                  />
                  <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={8}>
                    <FieldMeshIcon
                      name={showPassword ? 'visibility_off' : 'visibility'}
                      size={20}
                      color="#94a3b8"
                    />
                  </Pressable>
                </View>
              </View>

              {error && <Text style={styles.errorText}>{error}</Text>}

              <Pressable
                onPress={handleSignIn}
                disabled={busy}
                style={({ pressed }) => [styles.signInButton, pressed && styles.signInButtonPressed]}
              >
                {busy ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <>
                    <Text style={styles.signInButtonText}>Sign In</Text>
                    <FieldMeshIcon name="arrow_forward" size={18} color="#ffffff" />
                  </>
                )}
              </Pressable>

              <View style={styles.accountRow}>
                <Text style={styles.newTechText}>New here? </Text>
                <Pressable onPress={() => setActiveTab('signup')} hitSlop={6}>
                  <Text style={styles.createAccountText}>Create account</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Full Name</Text>
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
                <Text style={styles.fieldLabel}>Work Email</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="alex.m@fieldmesh.io"
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                  <FieldMeshIcon name="mail_outline" size={19} color="#94a3b8" />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Password (min. 8 characters)</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Choose a password"
                    placeholderTextColor="#94a3b8"
                    secureTextEntry={!showPassword}
                  />
                  <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={8}>
                    <FieldMeshIcon
                      name={showPassword ? 'visibility_off' : 'visibility'}
                      size={20}
                      color="#94a3b8"
                    />
                  </Pressable>
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Role</Text>
                <View style={styles.roleRow}>
                  {ROLES.map((r) => (
                    <Pressable
                      key={r.value}
                      onPress={() => setRole(r.value)}
                      style={[styles.rolePill, role === r.value && styles.rolePillActive]}
                    >
                      <Text style={[styles.rolePillText, role === r.value && styles.rolePillTextActive]}>
                        {r.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {error && <Text style={styles.errorText}>{error}</Text>}

              <Pressable
                onPress={handleSignUp}
                disabled={busy}
                style={({ pressed }) => [styles.signInButton, pressed && styles.signInButtonPressed]}
              >
                {busy ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <>
                    <Text style={styles.signInButtonText}>Create Account</Text>
                    <FieldMeshIcon name="arrow_forward" size={18} color="#ffffff" />
                  </>
                )}
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

        <View style={styles.securityFooter}>
          <FieldMeshIcon name="lock" size={13} color="#94a3b8" />
          <Text style={styles.securityFooterText}>Stored on this device only · SHA-256 hashed passwords</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f6fa' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, alignItems: 'center' },
  brandSection: { alignItems: 'center', marginBottom: 20 },
  logoContainer: { marginBottom: 12 },
  logoBox: {
    width: 52, height: 52, borderRadius: 14, backgroundColor: '#0f172a',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#0f172a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
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
    width: '100%', maxWidth: 420, backgroundColor: '#ffffff', borderRadius: 24, padding: 22,
    borderWidth: 1, borderColor: '#e8edf5',
    shadowColor: '#0f172a', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 18, elevation: 4,
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
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 12, height: 48, paddingHorizontal: 14,
  },
  textInput: { flex: 1, fontSize: 14, color: '#0f172a', height: '100%' },
  roleRow: { flexDirection: 'row', gap: 8 },
  rolePill: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0',
  },
  rolePillActive: { backgroundColor: '#ede9fe', borderColor: '#7c3aed' },
  rolePillText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  rolePillTextActive: { color: '#7c3aed' },
  errorText: { fontSize: 12.5, fontWeight: '600', color: FieldMeshColors.error },
  signInButton: {
    height: 50, backgroundColor: '#7c3aed', borderRadius: 12, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, marginTop: 4,
    shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4,
  },
  signInButtonPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  signInButtonText: { fontSize: 15, fontWeight: '700', color: '#ffffff', letterSpacing: 0.2 },
  accountRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingTop: 4 },
  newTechText: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  createAccountText: { fontSize: 13, color: '#7c3aed', fontWeight: '700' },
  securityFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 18, gap: 6 },
  securityFooterText: { fontSize: 12, fontWeight: '500', color: '#94a3b8' },
});
