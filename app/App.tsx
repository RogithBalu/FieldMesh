/**
 * FieldMesh App — includes a dev-only hotspot test button.
 *
 * @format
 */

import React, {useEffect, useRef, useState} from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import * as Y from 'yjs';

import {
  Colors,
  Header,
} from 'react-native/Libraries/NewAppScreen';

import {
  startHotspot,
  stopHotspot,
  getHotspotIpAddress,
  HotspotInfo,
} from './src/native/hotspot';
import {createTcpHub, TcpHub} from './src/hub/tcpHub';
import {buildWifiQr, buildSessionQr, generateSessionKey} from './src/session/qr';
import {SessionInfo} from './src/session/types';
import {
  startHubService,
  updateHubService,
  stopHubService,
} from './src/native/hubService';

const HUB_PORT = 9090;
const HUB_DOC = 'inspection:dev-001';

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';

  const [hotspotInfo, setHotspotInfo] = useState<HotspotInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Dev-only TCP hub test state ─────────────────────────────
  const hubRef = useRef<TcpHub | null>(null);
  const hubDocRef = useRef<Y.Doc | null>(null);
  const [hubRunning, setHubRunning] = useState(false);
  const [spokeCount, setSpokeCount] = useState(0);
  const [hubFields, setHubFields] = useState<Record<string, unknown>>({});
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    if (!hubRunning) return;
    let lastCount = -1;
    const interval = setInterval(() => {
      const count = hubRef.current?.spokes.size ?? 0;
      setSpokeCount(count);
      setHubFields(hubDocRef.current?.getMap('test').toJSON() ?? {});

      // Only touch the notification when the count actually moves.
      if (count !== lastCount) {
        lastCount = count;
        updateHubService({ssid: hotspotInfo?.ssid, spokes: count}).catch(
          () => {},
        );
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [hubRunning, hotspotInfo?.ssid]);

  const handleStartHub = async () => {
    setError(null);
    try {
      // The spoke needs somewhere to connect, so the hub's address on the
      // hotspot subnet has to be resolved before the session QR means anything.
      const host = await getHotspotIpAddress();
      const key = generateSessionKey();

      const doc = new Y.Doc();
      doc.getMap('test').set('hello', 'from-hub');
      hubDocRef.current = doc;
      hubRef.current = createTcpHub(doc, key, HUB_PORT);

      setSession({
        host,
        port: HUB_PORT,
        key,
        doc: HUB_DOC,
        ssid: hotspotInfo?.ssid,
      });
      // Without this the OS kills the listening socket minutes after the app
      // leaves the foreground, and the hub dies mid-inspection.
      const {notificationsVisible} = await startHubService({
        ssid: hotspotInfo?.ssid,
        spokes: 0,
      });
      if (!notificationsVisible) {
        setError(
          'Hub is running, but notifications are blocked so its status bar entry is hidden.',
        );
      }

      setHubRunning(true);
      setSpokeCount(0);
      setHubFields(doc.getMap('test').toJSON());
    } catch (e: any) {
      setError(e?.message || e?.code || JSON.stringify(e));
    }
  };

  const handleStopHub = () => {
    hubRef.current?.close();
    hubRef.current = null;
    hubDocRef.current = null;
    stopHubService().catch(() => {});
    setHubRunning(false);
    setSpokeCount(0);
    setHubFields({});
    setSession(null);
  };

  const wifiQr = hotspotInfo
    ? buildWifiQr(hotspotInfo.ssid, hotspotInfo.passphrase)
    : null;
  const sessionQr = session ? buildSessionQr(session) : null;

  const backgroundStyle = {
    backgroundColor: isDarkMode ? Colors.darker : Colors.lighter,
  };

  const handleStart = async () => {
    setError(null);
    setLoading(true);
    try {
      const info = await startHotspot();
      setHotspotInfo(info);
    } catch (e: any) {
      const msg = e?.message || e?.code || JSON.stringify(e);
      setError(msg);
      setHotspotInfo(null);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setError(null);
    try {
      await stopHotspot();
      setHotspotInfo(null);
    } catch (e: any) {
      const msg = e?.message || e?.code || JSON.stringify(e);
      setError(msg);
    }
  };

  return (
    <SafeAreaView style={[backgroundStyle, styles.container]}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={backgroundStyle.backgroundColor}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={backgroundStyle}>
        <Header />
        <View
          style={[
            styles.body,
            {backgroundColor: isDarkMode ? Colors.black : Colors.white},
          ]}>
          {/* ── Dev-only hotspot test section ───────────────── */}
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                {color: isDarkMode ? Colors.white : Colors.black},
              ]}>
              🛜 Hotspot Test (Dev)
            </Text>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.btn, styles.btnStart]}
                onPress={handleStart}
                disabled={loading}>
                <Text style={styles.btnText}>
                  {loading ? 'Starting…' : 'Start Hotspot'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, styles.btnStop]}
                onPress={handleStop}
                disabled={!hotspotInfo}>
                <Text style={styles.btnText}>Stop</Text>
              </TouchableOpacity>
            </View>

            {hotspotInfo && (
              <View style={styles.infoBox}>
                <Text style={styles.infoLabel}>SSID</Text>
                <Text style={styles.infoValue}>{hotspotInfo.ssid}</Text>
                <Text style={styles.infoLabel}>Passphrase</Text>
                <Text style={styles.infoValue}>{hotspotInfo.passphrase}</Text>
              </View>
            )}

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>❌ {error}</Text>
              </View>
            )}
          </View>

          {/* ── Dev-only TCP hub test section ───────────────── */}
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                {color: isDarkMode ? Colors.white : Colors.black},
              ]}>
              🔌 TCP Hub Test (Dev)
            </Text>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.btn, styles.btnStart]}
                onPress={handleStartHub}
                disabled={hubRunning}>
                <Text style={styles.btnText}>
                  {hubRunning ? `Running :${HUB_PORT}` : 'Start Hub'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, styles.btnStop]}
                onPress={handleStopHub}
                disabled={!hubRunning}>
                <Text style={styles.btnText}>Stop</Text>
              </TouchableOpacity>
            </View>

            {hubRunning && session && (
              <View style={styles.infoBox}>
                <Text style={styles.infoLabel}>Hub Address</Text>
                <Text style={styles.infoValue}>
                  {session.host}:{session.port}
                </Text>
                <Text style={styles.infoLabel}>Session Key</Text>
                <Text style={styles.infoValue}>{session.key}</Text>
                <Text style={styles.infoLabel}>Connected Spokes</Text>
                <Text style={styles.infoValue}>{spokeCount}</Text>
                <Text style={styles.infoLabel}>Doc Fields (test)</Text>
                <Text style={styles.infoValue}>
                  {JSON.stringify(hubFields)}
                </Text>
              </View>
            )}
          </View>

          {/* ── Dev-only site session QR payloads ───────────────── */}
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                {color: isDarkMode ? Colors.white : Colors.black},
              ]}>
              📶 Site Session QRs (Dev)
            </Text>

            {!wifiQr && !sessionQr && (
              <Text style={styles.hintText}>
                Start the hotspot for the Wi-Fi QR, then the hub for the session
                QR.
              </Text>
            )}

            {wifiQr && (
              <View style={styles.infoBox}>
                <Text style={styles.infoLabel}>Wi-Fi QR payload</Text>
                <Text style={styles.infoValue}>{wifiQr}</Text>
              </View>
            )}

            {sessionQr && (
              <View style={styles.infoBox}>
                <Text style={styles.infoLabel}>Session QR payload</Text>
                <Text style={styles.infoValue}>{sessionQr}</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  section: {
    marginTop: 32,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnStart: {
    backgroundColor: '#2e7d32',
    flex: 1,
  },
  btnStop: {
    backgroundColor: '#c62828',
    paddingHorizontal: 20,
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  infoBox: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1b5e20',
    textTransform: 'uppercase',
    marginTop: 8,
  },
  infoValue: {
    fontSize: 18,
    fontWeight: '500',
    color: '#212121',
    fontFamily: 'monospace',
  },
  errorBox: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#ffebee',
    borderRadius: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#b71c1c',
  },
  hintText: {
    fontSize: 14,
    color: '#757575',
    fontStyle: 'italic',
  },
});

export default App;
