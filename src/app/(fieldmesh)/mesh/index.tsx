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
import { useMesh } from '@/lib/mesh/useMesh';
import { isMeshAvailable, meshLabel, startMesh, stopMesh } from '@/lib/mesh/meshSession';
import { nameFor } from '@/lib/names';

interface Member {
  key: string;
  name: string;
  role?: string;
  device?: string;
  self: boolean;
  via: 'cloud' | 'mesh' | 'both';
  medium: string;
  relays?: boolean;
}

/**
 * Site session: who is connected to this inspection and how (cloud WebSocket
 * or the offline Nearby mesh), plus the sync server this phone uses.
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
  const [meshBusy, setMeshBusy] = useState(false);

  const author = useMemo(() => (user ? { id: user.id, name: user.name, role: user.role } : null), [user]);
  const doc = useInspectionDoc(id || undefined, deviceId, author, {});
  const mesh = useMesh();
  const meshForThis = !!id && mesh.inspectionId === id;

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
    Alert.alert('Switch server?', `The app will sync through ${url}. Sessions are per server, so you may need to sign in again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Switch',
        onPress: async () => {
          await setServerOverride(url);
          setJoinInput('');
          setTestResult(null);
        },
      },
    ]);
  };

  const resetServer = async () => {
    await setServerOverride(null);
    setTestResult(null);
  };

  const toggleMesh = async () => {
    if (!id || !user || !deviceId) return;
    setMeshBusy(true);
    try {
      if (meshForThis && mesh.status !== 'off' && mesh.status !== 'error') await stopMesh();
      else await startMesh(id, { userId: user.id, name: user.name, role: user.role, deviceId });
    } finally {
      setMeshBusy(false);
    }
  };

  // One row per person+device, whichever path(s) they are reachable on.
  const members: Member[] = useMemo(() => {
    const byKey = new Map<string, Member>();
    const cloudUp = doc.status === 'connected';
    if (user && deviceId) {
      byKey.set(`${user.id}|${deviceId}`, {
        key: 'self',
        name: user.name,
        role: user.role,
        device: deviceId,
        self: true,
        via: cloudUp ? 'cloud' : 'mesh',
        medium: cloudUp ? 'Internet (this device)' : meshForThis && mesh.peers.length ? 'Nearby (this device)' : 'Offline (this device)',
      });
    }
    for (const p of doc.peers) {
      if (p.self) continue;
      const key = `${p.userId ?? p.clientId}|${p.device ?? ''}`;
      byKey.set(key, { key, name: p.name ?? nameFor(p.userId), role: p.role, device: p.device, self: false, via: 'cloud', medium: 'Internet' });
    }
    if (meshForThis) {
      for (const p of mesh.peers) {
        const key = `${p.userId ?? p.endpointId}|${p.device ?? ''}`;
        const existing = byKey.get(key);
        const medium = meshLabel(p.medium);
        if (existing) byKey.set(key, { ...existing, via: 'both', medium: `${existing.medium} + ${medium}` });
        else byKey.set(key, { key, name: p.name ?? nameFor(p.userId), role: p.role, device: p.device, self: false, via: 'mesh', medium, relays: p.relaysToCloud });
      }
    }
    return [...byKey.values()];
  }, [doc.peers, doc.status, mesh.peers, meshForThis, user, deviceId]);

  const meshStatusLabel =
    !isMeshAvailable() || mesh.status === 'unavailable'
      ? 'Unavailable'
      : !meshForThis || mesh.status === 'off'
        ? 'Off'
        : mesh.status === 'starting'
          ? 'Starting…'
          : mesh.status === 'searching'
            ? 'Searching for phones…'
            : mesh.status === 'linked'
              ? `${mesh.peers.length} phone${mesh.peers.length === 1 ? '' : 's'} linked`
              : 'Error';
  const meshOn = meshForThis && (mesh.status === 'searching' || mesh.status === 'linked' || mesh.status === 'starting');

  return (
    <View style={styles.container}>
      <FieldMeshHeader
        title="Site Session"
        category="FIELD MESH NET"
        showBack
        statusBadge={
          id
            ? { label: `${members.length} connected`, variant: members.length > 1 ? 'connected' : 'offline' }
            : health === 'ok'
              ? { label: 'Server online', variant: 'connected' }
              : health === 'down'
                ? { label: 'Server unreachable', variant: 'warning' }
                : { label: 'Checking…', variant: 'offline' }
        }
      />

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.introBox}>
          <View style={styles.introHeaderRow}>
            <Text style={styles.introTag}>FIELD MESH PROTOCOL</Text>
            <View style={[styles.activePill, online === false && styles.activePillOff]}>
              <View style={[styles.activeDot, online === false && { backgroundColor: FieldMeshColors.outline }]} />
              <Text style={styles.activeText}>{online === false ? 'No internet' : 'Internet'}</Text>
            </View>
          </View>
          <Text style={styles.introDesc}>
            Edits are stored on this phone first. Online, they sync through the server; offline, phones within Bluetooth / Wi-Fi range sync directly, and any linked phone with internet relays for the rest.
          </Text>
        </View>

        {/* Members */}
        <View style={styles.peersSection}>
          <View style={styles.peersHeaderRow}>
            <Text style={styles.peersTitle}>{id ? `Connected members (${members.length})` : 'Connected members'}</Text>
            {id ? (
              <Text style={styles.meshVersion}>{doc.status === 'connected' ? (doc.synced ? 'cloud · synced' : 'cloud · syncing') : 'cloud · offline'}</Text>
            ) : null}
          </View>
          {!id ? (
            <View style={styles.emptyBox}>
              <FieldMeshIcon name="groups" size={26} color={FieldMeshColors.outline} />
              <Text style={styles.emptyText}>Members are tracked per inspection. Open a checklist and tap its “On site” badge to see who is connected and how.</Text>
            </View>
          ) : (
            <View style={styles.peersList}>
              {members.map((m) => (
                <View key={m.key} style={styles.peerCard}>
                  <View style={styles.peerLeft}>
                    <View style={[styles.peerAvatar, m.via !== 'cloud' && styles.peerAvatarMesh]}>
                      <Text style={styles.peerAvatarText}>{(m.name || '?').slice(0, 2).toUpperCase()}</Text>
                    </View>
                    <View style={styles.peerDetails}>
                      <View style={styles.peerNameRow}>
                        <Text style={styles.peerName}>{m.self ? `${m.name} (this device)` : m.name}</Text>
                        {m.role && (
                          <View style={styles.roleTag}>
                            <Text style={styles.roleTagText}>{m.role.toUpperCase()}</Text>
                          </View>
                        )}
                        {m.relays && (
                          <View style={[styles.roleTag, { backgroundColor: FieldMeshColors.secondaryContainer }]}>
                            <Text style={[styles.roleTagText, { color: FieldMeshColors.onSecondaryContainer }]}>RELAYS TO CLOUD</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.peerSub} numberOfLines={1}>
                        {m.device ?? 'unknown device'}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.statusPill, m.via !== 'cloud' && styles.statusPillMesh]}>
                    <FieldMeshIcon name={m.via === 'cloud' ? 'cloud_done' : m.via === 'both' ? 'sync' : 'sensors'} size={13} color={m.via === 'cloud' ? FieldMeshColors.secondary : FieldMeshColors.primary} />
                    <Text style={styles.onlineText} numberOfLines={2}>
                      {m.medium}
                    </Text>
                  </View>
                </View>
              ))}
              {members.length <= 1 && (
                <Text style={styles.emptyText}>
                  {doc.status === 'connected' ? 'No teammates have this inspection open right now.' : 'No one else is reachable yet. Start the offline mesh so nearby phones can link without internet.'}
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Offline mesh */}
        {id && (
          <View style={styles.sessionCard} testID="mesh-card">
            <View style={styles.sessionHeaderBar}>
              <View style={styles.sessionHeaderLeft}>
                <FieldMeshIcon name="sensors" size={20} color={meshOn ? FieldMeshColors.primary : FieldMeshColors.outline} />
                <Text style={styles.sessionTitle}>Offline mesh (Nearby)</Text>
              </View>
              <View style={[styles.meshPill, mesh.status === 'linked' && meshForThis && styles.meshPillOn]}>
                {meshForThis && (mesh.status === 'starting' || mesh.status === 'searching') && <ActivityIndicator size="small" color={FieldMeshColors.primary} />}
                <Text style={styles.meshPillText}>{meshStatusLabel}</Text>
              </View>
            </View>
            <Text style={styles.joinHint}>
              Phones on this inspection find each other over Bluetooth and upgrade to Wi-Fi Direct / hotspot automatically — no internet, no passwords. Keep Bluetooth and Wi-Fi switched on (airplane mode with both re-enabled is fine).
            </Text>
            {mesh.error && meshForThis && <Text style={styles.testResult}>{mesh.error}</Text>}
            {!isMeshAvailable() && <Text style={[styles.testResult, { color: FieldMeshColors.error }]}>Not available here: needs the installed FieldMesh app with Google Play services (not Expo Go).</Text>}
            {meshForThis && mesh.discovered.filter((d) => !mesh.peers.some((p) => p.endpointId === d.endpointId)).length > 0 && (
              <Text style={styles.previewText}>
                Found nearby: {mesh.discovered.filter((d) => !mesh.peers.some((p) => p.endpointId === d.endpointId)).map((d) => d.name.split('#')[0]).join(', ')} · connecting…
              </Text>
            )}
            <Pressable
              onPress={toggleMesh}
              disabled={meshBusy || !isMeshAvailable()}
              testID="mesh-toggle"
              style={({ pressed }) => [styles.joinBtn, meshOn && styles.stopBtn, (!isMeshAvailable() || meshBusy) && { opacity: 0.5 }, pressed && styles.btnPressed]}
            >
              {meshBusy ? <ActivityIndicator color="#fff" /> : <FieldMeshIcon name={meshOn ? 'sync_disabled' : 'sensors'} size={18} color={FieldMeshColors.onPrimary} />}
              <Text style={styles.joinBtnText}>{meshOn ? 'Stop offline mesh' : 'Start offline mesh'}</Text>
            </Pressable>
            {mesh.inspectionId && !meshForThis && (
              <Text style={styles.previewText}>A mesh session is running for another inspection; starting one here replaces it.</Text>
            )}
          </View>
        )}

        {/* Server card */}
        <View style={styles.sessionCard}>
          <View style={styles.sessionHeaderBar}>
            <View style={styles.sessionHeaderLeft}>
              <FieldMeshIcon name="dns" size={20} color={health === 'ok' ? FieldMeshColors.secondary : FieldMeshColors.outline} />
              <Text style={styles.sessionTitle}>Cloud sync server · {server.source === 'override' ? 'custom' : server.source === 'env' ? 'configured' : server.source === 'dev' ? 'dev host' : 'AWS Lightsail'}</Text>
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
          <Text style={styles.healthText}>{user ? `${user.name} · ${user.role} · ${user.email}` : 'Not signed in'}</Text>
        </View>

        <View style={styles.auditCard}>
          <View style={styles.auditRow}>
            <FieldMeshIcon name="lock" size={16} color={FieldMeshColors.secondary} />
            <Text style={styles.auditText}>JWT-authenticated cloud sync · Nearby links scoped per inspection</Text>
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
  sessionHeaderBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: FieldMeshColors.surfaceContainerLow, paddingHorizontal: 12, paddingVertical: 8, borderRadius: FieldMeshRadius.md, gap: 8 },
  sessionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  sessionTitle: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.onSurface, flexShrink: 1 },
  meshPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: FieldMeshColors.surfaceContainerHigh, paddingHorizontal: 8, paddingVertical: 4, borderRadius: FieldMeshRadius.full },
  meshPillOn: { backgroundColor: FieldMeshColors.secondaryContainer },
  meshPillText: { fontFamily: 'monospace', fontSize: 10.5, fontWeight: '700', color: FieldMeshColors.onSurface },
  credsGrid: { flexDirection: 'row', gap: 8 },
  credBox: { flex: 1, backgroundColor: FieldMeshColors.surfaceContainerLow, padding: 10, borderRadius: FieldMeshRadius.md, justifyContent: 'space-between', gap: 4 },
  credLabel: { fontSize: 10, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant, letterSpacing: 0.5 },
  credValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  credValue: { fontFamily: 'monospace', fontSize: 11.5, fontWeight: '700', color: FieldMeshColors.onSurface, flex: 1 },
  copyBtn: { width: 28, height: 28, borderRadius: FieldMeshRadius.sm, backgroundColor: FieldMeshColors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  healthText: { fontFamily: 'monospace', fontSize: 11, color: FieldMeshColors.onSurfaceVariant },
  joinBox: { gap: 6, borderTopWidth: 1, borderTopColor: FieldMeshColors.surfaceContainerLow, paddingTop: 10 },
  joinLabel: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.onSurface },
  joinHint: { fontSize: 11.5, color: FieldMeshColors.onSurfaceVariant, lineHeight: 16 },
  joinRow: { flexDirection: 'row', gap: 8 },
  joinInput: { flex: 1, height: 44, borderRadius: FieldMeshRadius.md, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh, paddingHorizontal: 12, fontSize: 13, fontFamily: 'monospace', color: FieldMeshColors.onSurface, backgroundColor: FieldMeshColors.surfaceContainerLow },
  testBtn: { paddingHorizontal: 14, height: 44, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  testBtnText: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.primary },
  previewText: { fontFamily: 'monospace', fontSize: 10.5, color: FieldMeshColors.outline },
  testResult: { fontSize: 12, fontWeight: '600', color: FieldMeshColors.onTertiaryFixedVariant },
  joinActions: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2 },
  joinBtn: { flex: 1, height: 48, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  stopBtn: { backgroundColor: FieldMeshColors.onSurfaceVariant },
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
  peerCard: { backgroundColor: FieldMeshColors.surfaceLowest, borderRadius: FieldMeshRadius.lg, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh },
  peerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  peerAvatar: { width: 38, height: 38, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  peerAvatarMesh: { backgroundColor: FieldMeshColors.primaryFixed },
  peerAvatarText: { fontFamily: 'monospace', fontSize: 13, fontWeight: '700', color: FieldMeshColors.primary },
  peerDetails: { flex: 1 },
  peerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  peerName: { fontSize: 14, fontWeight: '700', color: FieldMeshColors.onSurface },
  roleTag: { backgroundColor: FieldMeshColors.surfaceContainerHigh, paddingHorizontal: 6, paddingVertical: 1, borderRadius: FieldMeshRadius.xs },
  roleTagText: { fontFamily: 'monospace', fontSize: 9, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant },
  peerSub: { fontSize: 12, color: FieldMeshColors.onSurfaceVariant, marginTop: 2, fontFamily: 'monospace' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: FieldMeshColors.surfaceContainerLow, paddingHorizontal: 8, paddingVertical: 4, borderRadius: FieldMeshRadius.md, maxWidth: 150 },
  statusPillMesh: { backgroundColor: FieldMeshColors.primaryFixed },
  onlineText: { fontSize: 10.5, fontWeight: '600', color: FieldMeshColors.onSurfaceVariant, flexShrink: 1 },
  auditCard: { backgroundColor: FieldMeshColors.surfaceContainerLow, padding: 14, borderRadius: FieldMeshRadius.lg, alignItems: 'center', gap: 4 },
  auditRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  auditText: { fontSize: 12, fontWeight: '700', color: FieldMeshColors.onSurface, textAlign: 'center' },
  auditSub: { fontFamily: 'monospace', fontSize: 10, color: FieldMeshColors.onSurfaceVariant, textAlign: 'center' },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
});
