import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { FieldMeshColors, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshIcon } from './FieldMeshIcon';
import { parseSessionQr, type SessionInfo } from '@/lib/mesh/qr';

/**
 * Full-screen QR scanner for a hotspot session code, with a paste-the-code
 * fallback for phones without a working camera.
 */
export function SessionQrScanner({ visible, onClose, onSession }: { visible: boolean; onClose: () => void; onSession: (info: SessionInfo) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [locked, setLocked] = useState(false);

  const handleCode = (raw: string) => {
    if (locked) return;
    try {
      const info = parseSessionQr(raw);
      setLocked(true);
      setError(null);
      onSession(info);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const close = () => {
    setLocked(false);
    setError(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Scan session QR</Text>
          <Pressable onPress={close} hitSlop={10} style={styles.closeBtn} testID="scanner-close">
            <FieldMeshIcon name="close" size={22} color="#fff" />
          </Pressable>
        </View>

        {permission?.granted ? (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={locked ? undefined : ({ data }) => handleCode(data)}
          />
        ) : (
          <View style={styles.permBox}>
            <FieldMeshIcon name="photo_camera" size={36} color="#94a3b8" />
            <Text style={styles.permText}>Camera access is needed to scan the host phone’s QR code.</Text>
            <Pressable onPress={() => requestPermission()} style={styles.permBtn} testID="scanner-permission">
              <Text style={styles.permBtnText}>Allow camera</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.hint}>Point at the QR on the host phone’s Site Session screen.</Text>
          {error && <Text style={styles.error}>{error}</Text>}
          <Text style={styles.orText}>or paste the session code</Text>
          <View style={styles.row}>
            <TextInput
              style={styles.input}
              value={manual}
              onChangeText={setManual}
              placeholder="FMSESSION2:{…}"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              testID="scanner-manual"
            />
            <Pressable onPress={() => handleCode(manual)} disabled={!manual.trim()} style={[styles.joinBtn, !manual.trim() && { opacity: 0.4 }]} testID="scanner-join">
              <Text style={styles.joinBtnText}>Join</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 52, paddingBottom: 12 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  camera: { flex: 1 },
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  permText: { color: '#cbd5e1', textAlign: 'center', fontSize: 14, lineHeight: 20 },
  permBtn: { backgroundColor: FieldMeshColors.primaryContainer, paddingHorizontal: 18, paddingVertical: 12, borderRadius: FieldMeshRadius.md },
  permBtnText: { color: '#fff', fontWeight: '700' },
  footer: { padding: 20, gap: 8, backgroundColor: '#111827' },
  hint: { color: '#cbd5e1', fontSize: 13 },
  error: { color: '#fca5a5', fontSize: 12.5, fontWeight: '600' },
  orText: { color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, height: 44, borderRadius: FieldMeshRadius.md, backgroundColor: '#1f2937', color: '#fff', paddingHorizontal: 12, fontFamily: 'monospace', fontSize: 12 },
  joinBtn: { paddingHorizontal: 18, height: 44, borderRadius: FieldMeshRadius.md, backgroundColor: FieldMeshColors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  joinBtnText: { color: '#fff', fontWeight: '700' },
});
