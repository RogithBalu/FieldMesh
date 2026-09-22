import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { FieldMeshColors, FieldMeshRadius, FieldMeshSpacing } from '@/constants/fieldMeshTheme';
import { FieldMeshIcon } from './FieldMeshIcon';
import { SessionQrScanner } from './SessionQrScanner';
import { hostHotspot, isHotspotAvailable, joinHotspot, leaveHotspot, retryJoin, stopHotspotHost, type MeshIdentity, type MeshState } from '@/lib/mesh/meshSession';
import { inspectionIdFromDoc, type SessionInfo } from '@/lib/mesh/qr';

/**
 * Wi-Fi hotspot relay: host a local-only hotspot + hub for this inspection
 * (shows the session QR teammates scan), or join a host's session by QR /
 * pasted code. Members and their medium are listed by the Site Session screen.
 */
export function HotspotCard({ inspectionId, identity, mesh }: { inspectionId?: string; identity: MeshIdentity | null; mesh: MeshState }) {
  const router = useRouter();
  const hs = mesh.hotspot;
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showWifiQr, setShowWifiQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const available = isHotspotAvailable();
  const spokes = mesh.peers.filter((p) => p.via === 'hotspot');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const onSession = (info: SessionInfo) => {
    setScanning(false);
    if (!identity) return;
    void run(() => joinHotspot(info, identity));
  };

  const copyCode = async () => {
    if (!hs.sessionQr) return;
    await Clipboard.setStringAsync(hs.sessionQr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const joinedInspection = hs.joined ? inspectionIdFromDoc(hs.joined.doc) : null;

  return (
    <View style={styles.card} testID="hotspot-card">
      <View style={styles.headerBar}>
        <View style={styles.headerLeft}>
          <FieldMeshIcon name="wifi" size={20} color={hs.role === 'hosting' || hs.role === 'joined' ? FieldMeshColors.primary : FieldMeshColors.outline} />
          <Text style={styles.title}>Wi-Fi hotspot relay</Text>
        </View>
        <View style={[styles.pill, (hs.role === 'hosting' || hs.role === 'joined') && styles.pillOn]}>
          {(hs.role === 'starting' || hs.role === 'joining') && <ActivityIndicator size="small" color={FieldMeshColors.primary} />}
          <Text style={styles.pillText}>
            {hs.role === 'off' ? 'Off' : hs.role === 'starting' ? 'Starting…' : hs.role === 'hosting' ? `Hosting · ${spokes.length} joined` : hs.role === 'joining' ? 'Joining…' : hs.role === 'joined' ? 'Joined' : 'Error'}
          </Text>
        </View>
      </View>
      <Text style={styles.hint}>
        One phone hosts a private hotspot (no internet needed) and shows a QR; the others scan it to join and sync through that phone. If the host has internet, everything relays to the cloud.
      </Text>
      {!available && <Text style={styles.error}>Needs the installed FieldMesh app on Android 8+ (not Expo Go).</Text>}
      {hs.error && <Text style={styles.error}>{hs.error}</Text>}
      {hs.detail && (hs.role === 'joining' || hs.role === 'joined' || hs.role === 'starting') && <Text style={styles.detail}>{hs.detail}</Text>}

      {(hs.role === 'off' || hs.role === 'error') && (
        <View style={styles.actions}>
          <Pressable
            onPress={() => inspectionId && identity && run(() => hostHotspot(inspectionId, identity))}
            disabled={!available || busy || !inspectionId || !identity}
            style={({ pressed }) => [styles.btn, (!available || !inspectionId) && styles.btnDisabled, pressed && styles.pressed]}
            testID="hotspot-host"
          >
            {busy ? <ActivityIndicator color="#fff" /> : <FieldMeshIcon name="wifi" size={18} color={FieldMeshColors.onPrimary} />}
            <Text style={styles.btnText}>Host a hotspot session</Text>
          </Pressable>
          <Pressable onPress={() => setScanning(true)} disabled={!available || busy} style={({ pressed }) => [styles.btnAlt, !available && styles.btnDisabled, pressed && styles.pressed]} testID="hotspot-scan">
            <FieldMeshIcon name="qr_code_scanner" size={18} color={FieldMeshColors.primary} />
            <Text style={styles.btnAltText}>Scan a session QR to join</Text>
          </Pressable>
          {!inspectionId && <Text style={styles.detail}>Open an inspection to host a session for it; joining works from anywhere.</Text>}
          {hs.role === 'error' && hs.joined && (
            <Pressable onPress={() => run(retryJoin)} style={({ pressed }) => [styles.btnAlt, pressed && styles.pressed]} testID="hotspot-retry">
              <FieldMeshIcon name="refresh" size={18} color={FieldMeshColors.primary} />
              <Text style={styles.btnAltText}>Retry connecting to the hub</Text>
            </Pressable>
          )}
        </View>
      )}

      {hs.role === 'hosting' && (
        <>
          <View style={styles.qrBox}>
            {(showWifiQr ? hs.wifiQr : hs.sessionQr) ? <QRCode value={showWifiQr ? hs.wifiQr! : hs.sessionQr!} size={196} backgroundColor="#ffffff" color="#141b2b" /> : null}
            <Text style={styles.qrCaption}>{showWifiQr ? 'Wi-Fi QR — scan with the phone camera to join the hotspot' : 'Session QR — teammates scan this in FieldMesh (Site Session → Scan)'}</Text>
            <Pressable onPress={() => setShowWifiQr((v) => !v)} hitSlop={6}>
              <Text style={styles.link}>{showWifiQr ? 'Show session QR' : 'Show plain Wi-Fi QR instead'}</Text>
            </Pressable>
          </View>
          <View style={styles.grid}>
            <Cred label="HOTSPOT SSID" value={hs.ssid ?? ''} />
            <Cred label="PASSPHRASE" value={hs.passphrase ?? ''} />
          </View>
          <View style={styles.grid}>
            <Cred label="HUB ADDRESS" value={`${hs.host}:${hs.port}`} />
            <Cred label="SESSION KEY" value={hs.key ?? ''} />
          </View>
          <View style={styles.actions}>
            <Pressable onPress={copyCode} style={({ pressed }) => [styles.btnAlt, pressed && styles.pressed]} testID="hotspot-copy">
              <FieldMeshIcon name={copied ? 'check' : 'content_copy'} size={18} color={FieldMeshColors.primary} />
              <Text style={styles.btnAltText}>{copied ? 'Copied' : 'Copy session code (for pasting)'}</Text>
            </Pressable>
            <Pressable onPress={() => run(stopHotspotHost)} disabled={busy} style={({ pressed }) => [styles.btn, styles.btnStop, pressed && styles.pressed]} testID="hotspot-stop">
              {busy ? <ActivityIndicator color="#fff" /> : <FieldMeshIcon name="wifi_off" size={18} color={FieldMeshColors.onPrimary} />}
              <Text style={styles.btnText}>Stop hosting</Text>
            </Pressable>
          </View>
        </>
      )}

      {(hs.role === 'joining' || hs.role === 'joined') && (
        <View style={styles.actions}>
          {hs.joined && (
            <View style={styles.grid}>
              <Cred label="HOST" value={`${hs.joined.name ?? 'hub'} · ${hs.joined.host}:${hs.joined.port}`} />
              <Cred label="HOTSPOT" value={hs.joined.ssid ?? '—'} />
            </View>
          )}
          {hs.role === 'joined' && joinedInspection && joinedInspection !== inspectionId && (
            <Pressable onPress={() => router.push(`/(fieldmesh)/inspections/${joinedInspection}`)} style={({ pressed }) => [styles.btnAlt, pressed && styles.pressed]} testID="hotspot-open">
              <FieldMeshIcon name="description" size={18} color={FieldMeshColors.primary} />
              <Text style={styles.btnAltText}>Open the shared inspection</Text>
            </Pressable>
          )}
          <Pressable onPress={() => run(leaveHotspot)} disabled={busy} style={({ pressed }) => [styles.btn, styles.btnStop, pressed && styles.pressed]} testID="hotspot-leave">
            {busy ? <ActivityIndicator color="#fff" /> : <FieldMeshIcon name="wifi_off" size={18} color={FieldMeshColors.onPrimary} />}
            <Text style={styles.btnText}>Leave session</Text>
          </Pressable>
        </View>
      )}

      <SessionQrScanner visible={scanning} onClose={() => setScanning(false)} onSession={onSession} />
    </View>
  );
}

function Cred({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.credBox}>
      <Text style={styles.credLabel}>{label}</Text>
      <Text style={styles.credValue} selectable numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: FieldMeshColors.surfaceLowest, borderRadius: FieldMeshRadius.lg, padding: FieldMeshSpacing.md, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh, gap: 12 },
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: FieldMeshColors.surfaceContainerLow, paddingHorizontal: 12, paddingVertical: 8, borderRadius: FieldMeshRadius.md, gap: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  title: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.onSurface },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: FieldMeshColors.surfaceContainerHigh, paddingHorizontal: 8, paddingVertical: 4, borderRadius: FieldMeshRadius.full },
  pillOn: { backgroundColor: FieldMeshColors.secondaryContainer },
  pillText: { fontFamily: 'monospace', fontSize: 10.5, fontWeight: '700', color: FieldMeshColors.onSurface },
  hint: { fontSize: 11.5, color: FieldMeshColors.onSurfaceVariant, lineHeight: 16 },
  error: { fontSize: 12, fontWeight: '600', color: FieldMeshColors.error },
  detail: { fontFamily: 'monospace', fontSize: 11, color: FieldMeshColors.onSurfaceVariant },
  actions: { gap: 8 },
  btn: { height: 48, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnStop: { backgroundColor: FieldMeshColors.onSurfaceVariant },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontSize: 14, fontWeight: '700', color: FieldMeshColors.onPrimary },
  btnAlt: { height: 46, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.surfaceContainer, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnAltText: { fontSize: 13, fontWeight: '700', color: FieldMeshColors.primary },
  pressed: { opacity: 0.85 },
  qrBox: { alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#ffffff', borderRadius: FieldMeshRadius.lg, borderWidth: 1, borderColor: FieldMeshColors.surfaceContainerHigh },
  qrCaption: { fontSize: 11.5, color: FieldMeshColors.onSurfaceVariant, textAlign: 'center' },
  link: { fontSize: 12, fontWeight: '700', color: FieldMeshColors.primary },
  grid: { flexDirection: 'row', gap: 8 },
  credBox: { flex: 1, backgroundColor: FieldMeshColors.surfaceContainerLow, padding: 10, borderRadius: FieldMeshRadius.md, gap: 3 },
  credLabel: { fontSize: 10, fontWeight: '700', color: FieldMeshColors.onSurfaceVariant, letterSpacing: 0.5 },
  credValue: { fontFamily: 'monospace', fontSize: 12.5, fontWeight: '700', color: FieldMeshColors.onSurface },
});
