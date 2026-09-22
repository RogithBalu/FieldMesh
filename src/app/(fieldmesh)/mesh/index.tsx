import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldMeshColors, FieldMeshSpacing, FieldMeshRadius } from '@/constants/fieldMeshTheme';
import { FieldMeshHeader } from '@/components/fieldmesh/FieldMeshHeader';
import { FieldMeshIcon } from '@/components/fieldmesh/FieldMeshIcon';

export default function MeshNetworkScreen() {
  const insets = useSafeAreaInsets();

  const handleCopy = (label: string, text: string) => {
    Alert.alert('Copied to Clipboard', `${label}: ${text}`);
  };

  const peers = [
    {
      id: 'ravi',
      name: 'Ravi',
      initials: 'RJ',
      role: 'HUB',
      status: 'Relaying 2 devices',
      online: true,
      signal: 'Strong',
    },
    {
      id: 'priya',
      name: 'Priya',
      initials: 'PS',
      role: null,
      status: 'Synced 1m ago',
      online: true,
      signal: 'Strong',
    },
    {
      id: 'arun',
      name: 'Arun',
      initials: 'AK',
      role: null,
      status: 'Last seen 2 min ago',
      online: true,
      signal: 'Moderate',
    },
    {
      id: 'self',
      name: 'You (This Device)',
      initials: 'ME',
      role: 'HOST',
      status: 'Terminal #884 · Host node',
      online: true,
      signal: 'Self',
    },
  ];

  return (
    <View style={styles.container}>
      <FieldMeshHeader
        title="Site Session"
        category="FIELD MESH NET"
        showBack={true}
        statusBadge={{ label: 'On site · 4', variant: 'connected' }}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Intro banner */}
        <View style={styles.introBox}>
          <View style={styles.introHeaderRow}>
            <Text style={styles.introTag}>FIELD MESH PROTOCOL</Text>
            <View style={styles.activePill}>
              <View style={styles.activeDot} />
              <Text style={styles.activeText}>4 Peers Connected</Text>
            </View>
          </View>
          <Text style={styles.introDesc}>
            Share inspection state peer-to-peer without cellular or internet connectivity via localized BLE & WiFi Direct.
          </Text>
        </View>

        {/* Pairing Active Card */}
        <View style={styles.sessionCard}>
          <View style={styles.sessionHeaderBar}>
            <View style={styles.sessionHeaderLeft}>
              <FieldMeshIcon name="sensors" size={20} color={FieldMeshColors.secondary} />
              <Text style={styles.sessionTitle}>Session: North Grid Feeder Bay</Text>
            </View>
            <View style={styles.activeIndicatorDot} />
          </View>

          {/* QR Schematic Block */}
          <View style={styles.qrContainer}>
            <View style={styles.qrMock}>
              <FieldMeshIcon name="qr_code_scanner" size={96} color={FieldMeshColors.onSurface} />
            </View>
            <Text style={styles.qrHint}>
              Teammates scan this screen to join current mesh session.
            </Text>
          </View>

          {/* Mesh Credentials Grid */}
          <View style={styles.credsGrid}>
            <View style={styles.credBox}>
              <Text style={styles.credLabel}>MESH SSID</Text>
              <View style={styles.credValueRow}>
                <Text style={styles.credValue}>FM-MESH-SUB7</Text>
                <Pressable
                  onPress={() => handleCopy('Mesh SSID', 'FM-MESH-SUB7')}
                  style={({ pressed }) => [styles.copyBtn, pressed && styles.btnPressed]}
                >
                  <FieldMeshIcon name="content_copy" size={15} color={FieldMeshColors.onSurface} />
                </Pressable>
              </View>
            </View>

            <View style={styles.credBox}>
              <Text style={styles.credLabel}>PASSCODE / KEY</Text>
              <View style={styles.credValueRow}>
                <Text style={styles.credValue}>782-941</Text>
                <Pressable
                  onPress={() => handleCopy('Passcode', '782-941')}
                  style={({ pressed }) => [styles.copyBtn, pressed && styles.btnPressed]}
                >
                  <FieldMeshIcon name="content_copy" size={15} color={FieldMeshColors.onSurface} />
                </Pressable>
              </View>
            </View>
          </View>

          {/* Join button */}
          <Pressable
            onPress={() => Alert.alert('Camera Scanner', 'Ready to scan teammate pairing QR.')}
            style={({ pressed }) => [styles.joinBtn, pressed && styles.btnPressed]}
          >
            <FieldMeshIcon name="qr_code_scanner" size={20} color={FieldMeshColors.primary} />
            <Text style={styles.joinBtnText}>Join another session</Text>
          </Pressable>
        </View>

        {/* Peers List */}
        <View style={styles.peersSection}>
          <View style={styles.peersHeaderRow}>
            <Text style={styles.peersTitle}>People on site (4)</Text>
            <Text style={styles.meshVersion}>P2P Mesh v2.4</Text>
          </View>

          <View style={styles.peersList}>
            {peers.map((peer) => (
              <View key={peer.id} style={styles.peerCard}>
                <View style={styles.peerLeft}>
                  <View style={styles.peerAvatar}>
                    <Text style={styles.peerAvatarText}>{peer.initials}</Text>
                  </View>
                  <View style={styles.peerDetails}>
                    <View style={styles.peerNameRow}>
                      <Text style={styles.peerName}>{peer.name}</Text>
                      {peer.role && (
                        <View style={styles.roleTag}>
                          <Text style={styles.roleTagText}>{peer.role}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.peerSub}>{peer.status}</Text>
                  </View>
                </View>

                <View style={styles.statusPill}>
                  <View style={styles.onlineDot} />
                  <Text style={styles.onlineText}>Online</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Protocol Audit Footer Card */}
        <View style={styles.auditCard}>
          <View style={styles.auditRow}>
            <FieldMeshIcon name="lock" size={16} color={FieldMeshColors.secondary} />
            <Text style={styles.auditText}>End-to-End Encrypted (AES-256-GCM)</Text>
          </View>
          <Text style={styles.auditSub}>
            Zero cellular data consumed · Local cryptographic peer consensus
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
    padding: FieldMeshSpacing.gutter,
    gap: FieldMeshSpacing.md,
  },
  introBox: {
    gap: 4,
  },
  introHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  introTag: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.onSurfaceVariant,
    letterSpacing: 0.5,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: FieldMeshColors.secondaryContainer,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: FieldMeshRadius.full,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: FieldMeshColors.secondary,
  },
  activeText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: FieldMeshColors.onSecondaryContainer,
  },
  introDesc: {
    fontSize: 13,
    color: FieldMeshColors.onSurfaceVariant,
    lineHeight: 19,
    marginTop: 4,
  },
  sessionCard: {
    backgroundColor: FieldMeshColors.surfaceLowest,
    borderRadius: FieldMeshRadius.lg,
    padding: FieldMeshSpacing.md,
    borderWidth: 1,
    borderColor: FieldMeshColors.surfaceContainerHigh,
    gap: 12,
  },
  sessionHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: FieldMeshRadius.md,
  },
  sessionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  sessionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  activeIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: FieldMeshColors.secondary,
  },
  qrContainer: {
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  qrMock: {
    width: 140,
    height: 140,
    borderRadius: FieldMeshRadius.lg,
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: FieldMeshColors.surfaceContainerHigh,
  },
  qrHint: {
    fontSize: 12,
    color: FieldMeshColors.onSurfaceVariant,
    textAlign: 'center',
  },
  credsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  credBox: {
    flex: 1,
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    padding: 10,
    borderRadius: FieldMeshRadius.md,
    justifyContent: 'space-between',
    gap: 4,
  },
  credLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: FieldMeshColors.onSurfaceVariant,
    letterSpacing: 0.5,
  },
  credValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  credValue: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  copyBtn: {
    width: 28,
    height: 28,
    borderRadius: FieldMeshRadius.sm,
    backgroundColor: FieldMeshColors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBtn: {
    height: 48,
    borderRadius: FieldMeshRadius.md,
    backgroundColor: FieldMeshColors.surfaceContainer,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  joinBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: FieldMeshColors.primary,
  },
  peersSection: {
    gap: 10,
  },
  peersHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  peersTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  meshVersion: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: FieldMeshColors.onSurfaceVariant,
  },
  peersList: {
    gap: 8,
  },
  peerCard: {
    backgroundColor: FieldMeshColors.surfaceLowest,
    borderRadius: FieldMeshRadius.lg,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: FieldMeshColors.surfaceContainerHigh,
  },
  peerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  peerAvatar: {
    width: 38,
    height: 38,
    borderRadius: FieldMeshRadius.md,
    backgroundColor: FieldMeshColors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peerAvatarText: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: FieldMeshColors.primary,
  },
  peerDetails: {
    flex: 1,
  },
  peerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  peerName: {
    fontSize: 14,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  roleTag: {
    backgroundColor: FieldMeshColors.surfaceContainerHigh,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: FieldMeshRadius.xs,
  },
  roleTagText: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: FieldMeshColors.onSurfaceVariant,
  },
  peerSub: {
    fontSize: 12,
    color: FieldMeshColors.onSurfaceVariant,
    marginTop: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: FieldMeshRadius.full,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: FieldMeshColors.secondary,
  },
  onlineText: {
    fontSize: 11,
    fontWeight: '600',
    color: FieldMeshColors.secondary,
  },
  auditCard: {
    backgroundColor: FieldMeshColors.surfaceContainerLow,
    padding: 14,
    borderRadius: FieldMeshRadius.lg,
    alignItems: 'center',
    gap: 4,
  },
  auditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  auditText: {
    fontSize: 12,
    fontWeight: '700',
    color: FieldMeshColors.onSurface,
  },
  auditSub: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: FieldMeshColors.onSurfaceVariant,
    textAlign: 'center',
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
});
