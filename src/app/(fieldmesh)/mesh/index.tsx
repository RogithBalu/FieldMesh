import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';
import { useAuth } from '@/lib/auth-context';
import { api, errorMessage } from '@/lib/api';
import { describeServer, getServerOverride, normalizeServerInput, onServerConfigChange, setServerOverride, deriveWsUrl } from '@/lib/config';
import { useInspectionDoc } from '@/lib/useInspectionDoc';

/**
 * Site session: which FieldMesh server this phone syncs through (REST :3000 +
 * Hocuspocus :1234), its health, who is live on the current inspection
 * (awareness peers), and a way to point the app at another server.
 */
export default function MeshNetworkScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();
  const { user, deviceId, online } = useAuth();

  const [server, setServer] = useState(describeServer());
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');
  const [healthDetail, setHealthDetail] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const author = useMemo(() => (user ? { id: user.id, name: user.name, role: user.role } : null), [user]);
  const doc = useInspectionDoc(id || undefined, deviceId, author, {});

  const checkHealth = useCallback(async () => {
    let next: { health: 'ok' | 'down'; detail: string };
    try {
      const h = await api.health();
      next = { health: h.ok ? 'ok' : 'down', detail: h.service ?? '' };
    } catch (e) {
      next = { health: 'down', detail: errorMessage(e) };
    }
    setServer(describeServer());
    setHealth(next.health);
    setHealthDetail(next.detail);
  }, []);

  const recheckHealth = () => {
    setHealth('checking');
    checkHealth();
  };

  useEffect(() => {
    // Kick off the first check from a microtask so state updates land in a callback, not the effect body.
    Promise.resolve().then(checkHealth);
    return onServerConfigChange(checkHealth);
  }, [checkHealth]);

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const testServer = async () => {
    const url = normalizeServerInput(joinInput);
    if (!url) return;
    setTesting(true);
    setTestResult(null);
    try {
      const h = await api.health(url);
      setTestResult({ ok: !!h.ok, text: h.ok ? `${h.service} reachable at ${url}` : 'Server answered but is not healthy.' });
    } catch (e) {
      setTestResult({ ok: false, text: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  const useServer = () => {
    const url = normalizeServerInput(joinInput);
    if (!url) return;
    Alert.alert(
      'Switch server?',
      `The app will sync through ${url}. Sessions are per server, so you may need to sign in again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: async () => {
            await setServerOverride(url);
            setJoinInput('');
            setTestResult(null);
          },
        },
      ]
    );
  };

  const resetServer = async () => {
    await setServerOverride(null);
    setTestResult(null);
  };

  const peers = doc.peers;
  const others = peers.filter((p) => !p.self);

  return (
    <View style={styles.container}>
      <FieldMeshHeader
        title="Site Session"
        category="FIELD MESH NET"
        showBack
        statusBadge={
          health === 'ok' ? { label: 'Server online', variant: 'connected' } : health === 'down' ? { label: 'Server unreachable', variant: 'warning' } : { label: 'Checking…', variant: 'offline' }
        }
      />

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.introBox}>
          <View style={styles.introHeaderRow}>
            <Text style={styles.introTag}>FIELD MESH PROTOCOL</Text>
            <View style={[styles.activePill, online === false && styles.activePillOff]}>
              <View style={[styles.activeDot, online === false && { backgroundColor: FieldMeshColors.outline }]} />
              <Text style={styles.activeText}>{online === false ? 'Offline' : 'Connected'}</Text>
            </View>
          </View>
          <Text style={styles.introDesc}>
            Edits are stored on this phone first, then synced as CRDT updates through the server’s live channel. Conflicting offline edits are detected server-side and flagged for review.
          </Text>
        </View>

        {/* Server card */}
        <View style={styles.sessionCard}>
          <View style={styles.sessionHeaderBar}>
            <View style={styles.sessionHeaderLeft}>
              <FieldMeshIcon name="dns" size={20} color={health === 'ok' ? FieldMeshColors.secondary : FieldMeshColors.outline} />
              <Text style={styles.sessionTitle}>Sync server · {server.source === 'override' ? 'custom' : server.source === 'env' ? 'configured' : server.source === 'dev' ? 'dev host' : 'AWS Lightsail'}</Text>
            </View>
            <Pressable onPress={recheckHealth} hitSlop={8}>
              {health === 'checking' ? <ActivityIndicator size="small" color={FieldMeshColors.primary} /> : <FieldMeshIcon name="refresh" size={18} color={FieldMeshColors.primary} />}
            </Pressable>
          </View>

          <View style={styles.credsGrid}>
            <CredBox label="REST API" value={server.apiUrl} onCopy={() => copy('api', server.apiUrl)} copied={copied === 'api'} />
            <CredBox label="LIVE SYNC (WS)" value={server.wsUrl} onCopy={() => copy('ws', server.wsUrl)} copied={copied === 'ws'} />
          </View>
          <Text style={[styles.healthText, health === 'down' && { color: FieldMeshColors.error }]}>
            {health === 'ok' ? `GET /health → ok (${healthDetail})` : health === 'down' ? `GET /health failed: ${healthDetail}` : 'Checking GET /health…'}
          </Text>

          <View style={styles.joinBox}>
            <Text style={styles.joinLabel}>Join another session</Text>
            <Text style={styles.joinHint}>Enter a server IP or URL (port 3000 assumed). Live sync uses port 1234 on the same host.</Text>
            <View style={styles.joinRow}>
              <TextInput
                style={styles.joinInput}
                value={joinInput}
                onChangeText={setJoinInput}
                placeholder="e.g. 98.80.162.7 or http://10.0.0.5:3000"
                placeholderTextColor={FieldMeshColors.outline}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                testID="server-input"
              />
              <Pressable onPress={testServer} disabled={testing || !joinInput.trim()} style={({ pressed }) => [styles.testBtn, (!joinInput.trim() || testing) && { opacity: 0.4 }, pressed && styles.btnPressed]} testID="server-test">
                {testing ? <ActivityIndicator size="small" color={FieldMeshColors.primary} /> : <Text style={styles.testBtnText}>Test</Text>}
              </Pressable>
            </View>
            {joinInput.trim() ? <Text style={styles.previewText}>→ {normalizeServerInput(joinInput)} · {deriveWsUrl(normalizeServerInput(joinInput))}</Text> : null}
            {testResult && <Text style={[styles.testResult, { color: testResult.ok ? FieldMeshColors.secondary : FieldMeshColors.error }]}>{testResult.text}</Text>}
            <View style={styles.joinActions}>
              <Pressable onPress={useServer} disabled={!testResult?.ok} style={({ pressed }) => [styles.joinBtn, !testResult?.ok && { opacity: 0.4 }, pressed && styles.btnPressed]} testID="server-use">
                <FieldMeshIcon name="link" size={18} color={FieldMeshColors.onPrimary} />
                <Text style={styles.joinBtnText}>Use this server</Text>
              </Pressable>
              {getServerOverride() && (
                <Pressable onPress={resetServer} style={({ pressed }) => [styles.resetBtn, pressed && styles.btnPressed]} testID="server-reset">
                  <Text style={styles.resetBtnText}>Reset to default</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {/* Presence for the current inspection */}
        <View style={styles.peersSection}>
          <View style={styles.peersHeaderRow}>
            <Text style={styles.peersTitle}>{id ? `People on this inspection (${peers.length || (doc.status === 'connected' ? 1 : 0)})` : 'People on site'}</Text>
            <Text style={styles.meshVersion}>{id ? (doc.status === 'connected' ? (doc.synced ? 'live · synced' : 'live · syncing') : doc.status) : 'open an inspection'}</Text>
          </View>
          {!id ? (
            <View style={styles.emptyBox}>
              <FieldMeshIcon name="groups" size={26} color={FieldMeshColors.outline} />
              <Text style={styles.emptyText}>Presence is per inspection. Open a checklist and tap its “On site” badge to see who is editing it live.</Text>
            </View>
          ) : (
            <View style={styles.peersList}>
              {(peers.length ? peers : user ? [{ clientId: 0, userId: user.id, name: user.name, role: user.role, device: deviceId ?? undefined, self: true }] : []).map((peer) => (
                <View key={peer.clientId} style={styles.peerCard}>
                  <View style={styles.peerLeft}>
                    <View style={styles.peerAvatar}>
                      <Text style={styles.peerAvatarText}>{(peer.name ?? '?').slice(0, 2).toUpperCase()}</Text>
                    </View>
                    <View style={styles.peerDetails}>
                      <View style={styles.peerNameRow}>
                        <Text style={styles.peerName}>{peer.self ? `${peer.name ?? 'You'} (this device)` : peer.name ?? 'Teammate'}</Text>
                        {peer.role && (
                          <View style={styles.roleTag}>
                            <Text style={styles.roleTagText}>{peer.role.toUpperCase()}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.peerSub} numberOfLines={1}>
                        {peer.device ?? 'unknown device'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.statusPill}>
                    <View style={[styles.onlineDot, doc.status !== 'connected' && { backgroundColor: FieldMeshColors.outline }]} />
                    <Text style={styles.onlineText}>{doc.status === 'connected' ? 'Live' : 'Offline'}</Text>
                  </View>
                </View>
              ))}
              {doc.status === 'connected' && others.length === 0 && <Text style={styles.emptyText}>No teammates have this inspection open right now.</Text>}
            </View>
          )}
        </View>

        {/* This device */}
        <View style={styles.sessionCard}>
          <View style={styles.sessionHeaderBar}>
            <View style={styles.sessionHeaderLeft}>
              <FieldMeshIcon name="devices" size={20} color={FieldMeshColors.primary} />
              <Text style={styles.sessionTitle}>This device</Text>
            </View>
          </View>
          <View style={styles.credsGrid}>
            <CredBox label="OPERATOR ID" value={user?.id ?? '—'} onCopy={() => user && copy('uid', user.id)} copied={copied === 'uid'} />
            <CredBox label="DEVICE ID (HLC NODE)" value={deviceId ?? '—'} onCopy={() => deviceId && copy('dev', deviceId)} copied={copied === 'dev'} />
          </View>
          <Text style={styles.healthText}>
            {user ? `${user.name} · ${user.role} · ${user.email}` : 'Not signed in'}
          </Text>
        </View>

        <View style={styles.auditCard}>
          <View style={styles.auditRow}>
            <FieldMeshIcon name="lock" size={16} color={FieldMeshColors.secondary} />
            <Text style={styles.auditText}>JWT-authenticated REST + WebSocket</Text>
          </View>
          <Text style={styles.auditSub}>Edits carry hybrid logical clocks and parent ids · disputes settle on the server</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function CredBox({ label, value, onCopy, copied }: { label: string; value: string; onCopy: () => void; copied: boolean }) {
  return (
    <View style={styles.credBox}>
      <Text style={styles.credLabel}>{label}</Text>
      <View style={styles.credValueRow}>
        <Text style={styles.credValue} numberOfLines={2}>
          {value}
        </Text>
        <Pressable onPress={onCopy} style={({ pressed }) => [styles.copyBtn, pressed && styles.btnPressed]}>
          <FieldMeshIcon name={copied ? 'check' : 'content_copy'} size={15} color={copied ? FieldMeshColors.secondary : FieldMeshColors.onSurface} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FieldMeshColors.surface },
  scroll: { flex: 1 },
  content: { padding: FieldMeshSpacing.gutter, gap: FieldMeshSpacing.md },
  introBox: { gap: 4 },
  introHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  introTag: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant, letterSpacing: 0.5 },
  activePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: FieldMeshColors.secondaryContainer, paddingHorizontal: 10, paddingVertical: 4, borderRadius: FieldMeshRadius.full },
  activePillOff: { backgroundColor: FieldMeshColors.surfaceContainerHigh },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: FieldMeshColors.secondary },
  activeText: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', color: FieldMeshColors.onSurface },
  introDesc: { fontSize: 13, color: FieldMeshColors.onSurfaceVariant, lineHeight: 19, marginTop: 4 },
  sessionCard: { backgroundColor: FieldMeshColors.surfaceLowest, borderRadius: FieldMeshRadius.lg, padding: FieldMeshSpacing.md, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh, gap: 12 },
  sessionHeaderBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: FieldMeshColors.surfaceContainerLow, paddingHorizontal: 12, paddingVertical: 8, borderRadius: FieldMeshRadius.md },
  sessionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  sessionTitle: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.onSurface },
  credsGrid: { flexDirection: 'row', gap: 8 },
  credBox: { flex: 1, backgroundColor: FieldMeshColors.surfaceContainerLow, padding: 10, borderRadius: FieldMeshRadius.md, justifyContent: 'space-between', gap: 4 },
  credLabel: { fontSize: 10, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant, letterSpacing: 0.5 },
  credValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  credValue: { fontFamily: 'monospace', fontSize: 11.5, fontWeight: '700', color: FieldMeshColors.onSurface, flex: 1 },
  copyBtn: { width: 28, height: 28, borderRadius: FieldMeshRadius.sm, backgroundColor: FieldMeshColors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  healthText: { fontFamily: 'monospace', fontSize: 11, color: FieldMeshColors.onSurfaceVariant },
  joinBox: { gap: 6, borderTopWidth: 1, borderTopColor: FieldMeshColors.surfaceContainerLow, paddingTop: 10 },
  joinLabel: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.onSurface },
  joinHint: { fontSize: 11, color: FieldMeshColors.onSurfaceVariant, lineHeight: 15 },
  joinRow: { flexDirection: 'row', gap: 8 },
  joinInput: { flex: 1, height: 44, borderRadius: FieldMeshRadius.md, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh, paddingHorizontal: 12, fontSize: 13, fontFamily: 'monospace', color: FieldMeshColors.onSurface, backgroundColor: FieldMeshColors.surfaceContainerLow },
  testBtn: { paddingHorizontal: 14, height: 44, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  testBtnText: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.primary },
  previewText: { fontFamily: 'monospace', fontSize: 10, color: FieldMeshColors.outline },
  testResult: { fontSize: 12, fontWeight: '600' },
  joinActions: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2 },
  joinBtn: { flex: 1, height: 46, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  joinBtnText: { fontSize: 14, fontWeight: '700', color: FieldMeshColors.onPrimary },
  resetBtn: { paddingHorizontal: 12, height: 46, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  resetBtnText: { fontSize: 12, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant },
  peersSection: { gap: 10 },
  peersHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2, gap: 8 },
  peersTitle: { fontSize: 16, fontWeight: '700', color: FieldMeshColors.onSurface, flexShrink: 1 },
  meshVersion: { fontFamily: 'monospace', fontSize: 11, color: FieldMeshColors.onSurfaceVariant },
  emptyBox: { alignItems: 'center', gap: 8, padding: 20, backgroundColor: FieldMeshColors.surfaceContainerLow, borderRadius: FieldMeshRadius.lg },
  emptyText: { fontSize: 12, color: FieldMeshColors.onSurfaceVariant, textAlign: 'center', lineHeight: 17 },
  peersList: { gap: 8 },
  peerCard: { backgroundColor: FieldMeshColors.surfaceLowest, borderRadius: FieldMeshRadius.lg, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh },
  peerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  peerAvatar: { width: 38, height: 38, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  peerAvatarText: { fontFamily: 'monospace', fontSize: 13, fontWeight: '700', color: FieldMeshColors.primary },
  peerDetails: { flex: 1 },
  peerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  peerName: { fontSize: 14, fontWeight: '700', color: FieldMeshColors.onSurface },
  roleTag: { backgroundColor: FieldMeshColors.surfaceContainerHigh, paddingHorizontal: 6, paddingVertical: 1, borderRadius: FieldMeshRadius.xs },
  roleTagText: { fontFamily: 'monospace', fontSize: 9, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant },
  peerSub: { fontSize: 12, color: FieldMeshColors.onSurfaceVariant, marginTop: 2, fontFamily: 'monospace' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: FieldMeshColors.surfaceContainerLow, paddingHorizontal: 8, paddingVertical: 4, borderRadius: FieldMeshRadius.full },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: FieldMeshColors.secondary },
  onlineText: { fontSize: 11, fontWeight: '600', color: FieldMeshColors.onSurfaceVariant },
  auditCard: { backgroundColor: FieldMeshColors.surfaceContainerLow, padding: 14, borderRadius: FieldMeshRadius.lg, alignItems: 'center', gap: 4 },
  auditRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  auditText: { fontSize: 12, fontWeight: '700', color: FieldMeshColors.onSurface },
  auditSub: { fontFamily: 'monospace', fontSize: 10, color: FieldMeshColors.onSurfaceVariant, textAlign: 'center' },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
});
