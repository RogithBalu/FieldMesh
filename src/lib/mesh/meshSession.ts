/**
 * The offline site mesh for one inspection — two link types, one document.
 *
 *  - Nearby (Google Nearby Connections): every participating phone advertises
 *    AND discovers under a service id derived from the inspection id; links are
 *    auto-accepted with a deterministic tie-break so two phones dial once.
 *  - Hotspot: one phone starts a local-only Wi-Fi hotspot and a TCP hub; others
 *    scan its session QR (SSID, passphrase, hub address, session key), join
 *    the Wi-Fi and connect. The hub checks the key before attaching a spoke.
 *
 * Every link runs its own YjsSync on the inspection's shared Y.Doc (from
 * docRegistry) — the same document the Hocuspocus provider syncs when a phone
 * has internet — so any phone with a connection relays the whole mesh to the
 * cloud, and the cloud's edits back, with no forwarding code. Peers exchange a
 * HELLO frame carrying their identity and whether they are relaying.
 */
import type { EventSubscription } from 'expo-modules-core';
import FieldMeshNearby from '../../../modules/fieldmesh-nearby';
import FieldMeshHotspot from '../../../modules/fieldmesh-hotspot';
import { acquireDoc, type DocHandle } from '../docRegistry';
import { rememberName } from '../names';
import { base64ToBytes, bytesToUtf8, utf8ToBytes } from '../base64';
import { FrameReader, Msg, decode, encode, frame, type Transport } from './framing';
import { NearbyTransport } from './nearbyTransport';
import { TcpTransport } from './tcpTransport';
import { YjsSync } from './yjsSync';
import { requestHotspotPermissions, requestMeshPermissions, requestNotificationPermission } from './permissions';
import { buildSessionQr, buildWifiQr, generateSessionKey, inspectionIdFromDoc, type SessionInfo } from './qr';

export type MeshMedium = 'bluetooth-le' | 'bluetooth' | 'wifi' | 'wifi-hotspot' | 'unknown';
export type MeshStatus = 'unavailable' | 'off' | 'starting' | 'searching' | 'linked' | 'error';
export type LinkVia = 'nearby' | 'hotspot';
export type HotspotRole = 'off' | 'starting' | 'hosting' | 'joining' | 'joined' | 'error';

export interface MeshPeer {
  id: string;
  via: LinkVia;
  endpointName?: string;
  userId?: string;
  name?: string;
  role?: string;
  device?: string;
  medium: MeshMedium;
  linkedAt: number;
  /** True while this peer reports it also has a cloud connection (it relays for us). */
  relaysToCloud?: boolean;
}

export interface MeshIdentity {
  userId: string;
  name: string;
  role?: string;
  deviceId: string;
}

export interface HotspotState {
  role: HotspotRole;
  ssid?: string;
  passphrase?: string;
  host?: string;
  port?: number;
  key?: string;
  doc?: string;
  sessionQr?: string;
  wifiQr?: string;
  /** What we joined (spoke side). */
  joined?: SessionInfo;
  detail?: string;
  error: string | null;
}

export interface MeshState {
  /** Nearby link status. */
  status: MeshStatus;
  inspectionId: string | null;
  peers: MeshPeer[];
  discovered: { endpointId: string; name: string }[];
  error: string | null;
  startedAt: number | null;
  hotspot: HotspotState;
}

interface Link {
  transport: Transport;
  sync: YjsSync;
  peer: MeshPeer;
}

const HUB_PORT = 9090;
const listeners = new Set<() => void>();
let state: MeshState = {
  status: FieldMeshNearby ? 'off' : 'unavailable',
  inspectionId: null,
  peers: [],
  discovered: [],
  error: null,
  startedAt: null,
  hotspot: { role: 'off', error: null },
};
let handle: DocHandle | null = null;
const docUsers = new Set<LinkVia>();
let identity: MeshIdentity | null = null;
let nearbySubs: EventSubscription[] = [];
let hotspotSubs: EventSubscription[] = [];
const links = new Map<string, Link>();
let cloudConnected = false;

// Hub-side clients that have connected but not yet presented the session key.
const pendingClients = new Map<string, { reader: FrameReader; timer: ReturnType<typeof setTimeout> }>();
let hubKey: string | null = null;
// Spoke-side reconnect bookkeeping.
let spokeInfo: SessionInfo | null = null;
let spokeAttempts = 0;
let spokeTimer: ReturnType<typeof setTimeout> | null = null;
let spokeStopped = true;

function setState(patch: Partial<MeshState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function setHotspot(patch: Partial<HotspotState>) {
  setState({ hotspot: { ...state.hotspot, ...patch } });
}

export function getMeshState(): MeshState {
  return state;
}

export function subscribeMesh(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isMeshAvailable(): boolean {
  return !!FieldMeshNearby && FieldMeshNearby.isAvailable();
}

export function isHotspotAvailable(): boolean {
  return !!FieldMeshHotspot && FieldMeshHotspot.isSupported();
}

/** Called by the doc registry so peers learn whether we can relay them to the cloud. */
export function setMeshCloudConnected(connected: boolean) {
  if (cloudConnected === connected) return;
  cloudConnected = connected;
  for (const link of links.values()) sendHello(link.sync);
}

export function meshLabel(medium: MeshMedium): string {
  switch (medium) {
    case 'wifi':
      return 'Wi-Fi Direct / hotspot';
    case 'wifi-hotspot':
      return 'Wi-Fi hotspot';
    case 'bluetooth':
      return 'Bluetooth';
    case 'bluetooth-le':
      return 'Bluetooth LE';
    default:
      return 'Nearby (negotiating)';
  }
}

// ── shared doc + links ───────────────────────────────────────────────────────

function ensureDoc(inspectionId: string, id: MeshIdentity, user: LinkVia) {
  if (state.inspectionId && state.inspectionId !== inspectionId) {
    // One site session at a time; a different inspection replaces it.
    void stopAllMesh();
  }
  identity = id;
  if (!handle) handle = acquireDoc(inspectionId, id.deviceId, { id: id.userId, name: id.name, role: id.role });
  docUsers.add(user);
  setState({ inspectionId });
}

function releaseDoc(user: LinkVia) {
  docUsers.delete(user);
  if (docUsers.size === 0) {
    handle?.release();
    handle = null;
    identity = null;
    setState({ inspectionId: null });
  }
}

function sendHello(sync: YjsSync) {
  if (!identity) return;
  const hello = { u: identity.userId, n: identity.name, r: identity.role, d: identity.deviceId, c: cloudConnected };
  sync.sendFrame(Msg.HELLO, utf8ToBytes(JSON.stringify(hello)));
}

function publishPeers() {
  const peers = [...links.values()].map((l) => l.peer);
  const nearbyLinked = peers.some((p) => p.via === 'nearby');
  setState({
    peers,
    status: state.status === 'off' || state.status === 'unavailable' || state.status === 'error' ? state.status : nearbyLinked ? 'linked' : 'searching',
  });
}

function attachLink(id: string, transport: Transport, seed: Pick<MeshPeer, 'via' | 'medium'> & Partial<MeshPeer>) {
  if (!handle || links.has(id)) return;
  const sync = new YjsSync(handle.doc, transport);
  const link: Link = { transport, sync, peer: { id, linkedAt: Date.now(), ...seed } };
  sync.onOther = (type, payload) => {
    if (type !== Msg.HELLO) return;
    try {
      const h = JSON.parse(bytesToUtf8(payload)) as { u?: string; n?: string; r?: string; d?: string; c?: boolean };
      link.peer = { ...link.peer, userId: h.u, name: h.n ?? link.peer.name, role: h.r, device: h.d, relaysToCloud: !!h.c };
      rememberName(h.u, h.n);
      publishPeers();
    } catch {
      /* ignore malformed hello */
    }
  };
  transport.onStatus((status) => {
    if (status === 'closed' || status === 'error') onLinkClosed(id);
  });
  links.set(id, link);
  sync.start();
  sendHello(sync);
  publishPeers();
}

function detachLink(id: string) {
  const link = links.get(id);
  if (!link) return;
  link.sync.stop();
  links.delete(id);
  link.transport.close().catch(() => {});
  publishPeers();
}

function onLinkClosed(id: string) {
  const wasSpoke = id.startsWith('tcp-client:');
  detachLink(id);
  if (wasSpoke && !spokeStopped && spokeInfo) scheduleSpokeReconnect('hub connection lost');
}

// ── Nearby ───────────────────────────────────────────────────────────────────

function serviceIdFor(inspectionId: string): string {
  return `com.fieldmesh.inspect.${inspectionId}`;
}

function endpointNameFor(id: MeshIdentity): string {
  return `${id.name.slice(0, 24)}#${id.deviceId.slice(-8)}`;
}

function suffixOf(endpointName: string): string {
  const i = endpointName.lastIndexOf('#');
  return i >= 0 ? endpointName.slice(i + 1) : endpointName;
}

function mediumFor(quality: number): MeshMedium {
  return quality === 3 ? 'wifi' : quality === 2 ? 'bluetooth' : quality === 1 ? 'bluetooth-le' : 'unknown';
}

export async function startMesh(inspectionId: string, id: MeshIdentity): Promise<void> {
  if (!FieldMeshNearby) {
    setState({ status: 'unavailable', error: 'The offline mesh needs the installed FieldMesh app (not Expo Go).' });
    return;
  }
  if (!FieldMeshNearby.isAvailable()) {
    setState({ status: 'unavailable', error: 'Google Play services are not available on this phone.' });
    return;
  }
  if (state.inspectionId === inspectionId && (state.status === 'searching' || state.status === 'linked' || state.status === 'starting')) return;
  await stopMesh();

  setState({ status: 'starting', error: null, discovered: [], startedAt: Date.now() });
  const perm = await requestMeshPermissions();
  if (!perm.granted) {
    setState({ status: 'error', error: `Permission needed: ${perm.missing.join(', ')}` });
    return;
  }

  ensureDoc(inspectionId, id, 'nearby');
  const native = FieldMeshNearby;
  const myName = endpointNameFor(id);
  const serviceId = serviceIdFor(inspectionId);

  nearbySubs.push(
    native.addListener('onEndpointFound', (e) => {
      if (e.serviceId && e.serviceId !== serviceId) return;
      setState({ discovered: [...state.discovered.filter((d) => d.endpointId !== e.endpointId), { endpointId: e.endpointId, name: e.name }] });
      if (suffixOf(myName) < suffixOf(e.name) && !links.has(`nearby:${e.endpointId}`)) {
        native.requestConnection(myName, e.endpointId).catch((err: Error) => {
          setState({ error: `Connect to ${e.name.split('#')[0]} failed: ${err.message}` });
        });
      }
    }),
    native.addListener('onEndpointLost', (e) => {
      setState({ discovered: state.discovered.filter((d) => d.endpointId !== e.endpointId) });
    }),
    native.addListener('onConnected', (e) =>
      attachLink(`nearby:${e.endpointId}`, new NearbyTransport(e.endpointId), { via: 'nearby', medium: 'unknown', endpointName: e.name, name: e.name.split('#')[0] })
    ),
    native.addListener('onDisconnected', (e) => detachLink(`nearby:${e.endpointId}`)),
    native.addListener('onBandwidthChanged', (e) => {
      const link = links.get(`nearby:${e.endpointId}`);
      if (!link) return;
      link.peer = { ...link.peer, medium: mediumFor(e.quality) };
      publishPeers();
    })
  );

  try {
    await native.startAdvertising(serviceId, myName);
    await native.startDiscovery(serviceId);
    setState({ status: 'searching' });
  } catch (e) {
    setState({ status: 'error', error: (e as Error).message ?? 'Could not start Nearby' });
    await stopMesh();
  }
}

export async function stopMesh(): Promise<void> {
  for (const id of [...links.keys()]) if (id.startsWith('nearby:')) detachLink(id);
  for (const s of nearbySubs) s.remove();
  nearbySubs = [];
  try {
    await FieldMeshNearby?.stopAll();
  } catch {
    /* ignore */
  }
  if (docUsers.has('nearby')) releaseDoc('nearby');
  setState({ status: FieldMeshNearby ? 'off' : 'unavailable', discovered: [], startedAt: null, peers: [...links.values()].map((l) => l.peer) });
}

// ── Hotspot hub (host) ───────────────────────────────────────────────────────

function unsubscribeHotspot() {
  for (const s of hotspotSubs) s.remove();
  hotspotSubs = [];
}

export async function hostHotspot(inspectionId: string, id: MeshIdentity): Promise<void> {
  const native = FieldMeshHotspot;
  if (!native || !native.isSupported()) {
    setHotspot({ role: 'error', error: 'Hotspot sessions need the installed FieldMesh app on Android 8 or newer.' });
    return;
  }
  await leaveHotspot();
  await stopHotspotHost();
  setHotspot({ role: 'starting', error: null, detail: 'Starting hotspot…' });

  const perm = await requestHotspotPermissions();
  if (!perm.granted) {
    setHotspot({ role: 'error', error: `Permission needed: ${perm.missing.join(', ')}` });
    return;
  }

  ensureDoc(inspectionId, id, 'hotspot');
  const key = generateSessionKey();
  hubKey = key;
  try {
    const hs = await native.startHotspot();
    const { port } = await native.startServer(HUB_PORT);
    const doc = `inspection:${inspectionId}`;
    const info: SessionInfo = { host: hs.ip, port, key, doc, ssid: hs.ssid, pass: hs.passphrase, name: id.name };

    hotspotSubs.push(
      native.addListener('onClientConnected', (e) => {
        const timer = setTimeout(() => {
          if (pendingClients.has(e.clientId)) {
            pendingClients.delete(e.clientId);
            native.disconnectClient(e.clientId).catch(() => {});
          }
        }, 8000);
        pendingClients.set(e.clientId, { reader: new FrameReader(), timer });
      }),
      native.addListener('onServerData', (e) => {
        const pending = pendingClients.get(e.clientId);
        if (!pending) return;
        const frames = pending.reader.push(base64ToBytes(e.data));
        for (const f of frames) {
          const { type, payload } = decode(f);
          const ok = type === Msg.SESSION_KEY && bytesToUtf8(payload) === hubKey;
          clearTimeout(pending.timer);
          pendingClients.delete(e.clientId);
          if (!ok) {
            native.disconnectClient(e.clientId).catch(() => {});
            return;
          }
          const transport = new TcpTransport('server', e.clientId);
          attachLink(`tcp-server:${e.clientId}`, transport, { via: 'hotspot', medium: 'wifi-hotspot' });
          transport.injectReceived(pending.reader.remaining());
          return;
        }
      }),
      native.addListener('onClientDisconnected', (e) => {
        const pending = pendingClients.get(e.clientId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingClients.delete(e.clientId);
        }
        detachLink(`tcp-server:${e.clientId}`);
      }),
      native.addListener('onHotspotStopped', () => {
        setHotspot({ role: 'error', error: 'The system stopped the hotspot.' });
        void stopHotspotHost();
      })
    );

    await requestNotificationPermission();
    native.startHubService(`${hs.ssid} · hosting ${id.name}'s site session`).catch(() => {});

    setHotspot({
      role: 'hosting',
      ssid: hs.ssid,
      passphrase: hs.passphrase,
      host: hs.ip,
      port,
      key,
      doc,
      sessionQr: buildSessionQr(info),
      wifiQr: buildWifiQr(hs.ssid, hs.passphrase),
      detail: undefined,
      error: null,
    });
  } catch (e) {
    setHotspot({ role: 'error', error: (e as Error).message ?? 'Could not start the hotspot session' });
    await stopHotspotHost();
  }
}

export async function stopHotspotHost(): Promise<void> {
  const native = FieldMeshHotspot;
  for (const id of [...links.keys()]) if (id.startsWith('tcp-server:')) detachLink(id);
  for (const [, p] of pendingClients) clearTimeout(p.timer);
  pendingClients.clear();
  hubKey = null;
  if (state.hotspot.role === 'hosting' || state.hotspot.role === 'starting' || state.hotspot.role === 'error') {
    unsubscribeHotspot();
    try {
      await native?.stopServer();
      await native?.stopHubService();
      await native?.stopHotspot();
    } catch {
      /* ignore */
    }
    if (docUsers.has('hotspot')) releaseDoc('hotspot');
    setHotspot({ role: 'off', ssid: undefined, passphrase: undefined, host: undefined, port: undefined, key: undefined, doc: undefined, sessionQr: undefined, wifiQr: undefined, detail: undefined });
  }
}

// ── Hotspot spoke (join) ─────────────────────────────────────────────────────

async function spokeConnect(): Promise<void> {
  const native = FieldMeshHotspot;
  if (!native || !spokeInfo || spokeStopped) return;
  const info = spokeInfo;
  setHotspot({ role: 'joining', detail: spokeAttempts > 0 ? `Reconnecting to hub (attempt ${spokeAttempts + 1})…` : 'Connecting to hub…' });
  try {
    const connId = await native.connect(info.host, info.port, 10000);
    if (spokeStopped) {
      native.disconnect(connId).catch(() => {});
      return;
    }
    const transport = new TcpTransport('client', connId);
    await transport.send(frame(encode(Msg.SESSION_KEY, utf8ToBytes(info.key))));
    attachLink(`tcp-client:${connId}`, transport, { via: 'hotspot', medium: 'wifi-hotspot', name: info.name });
    spokeAttempts = 0;
    setHotspot({ role: 'joined', detail: `Linked to ${info.name ?? 'hub'} at ${info.host}:${info.port}`, error: null });
  } catch (e) {
    spokeAttempts++;
    scheduleSpokeReconnect((e as Error).message ?? 'connect failed');
  }
}

function scheduleSpokeReconnect(reason: string) {
  if (spokeStopped) return;
  if (spokeAttempts >= 20) {
    setHotspot({ role: 'error', error: `Gave up reconnecting: ${reason}` });
    return;
  }
  const delay = Math.min(1000 * Math.pow(2, Math.max(0, spokeAttempts - 1)), 30000);
  setHotspot({ role: 'joining', detail: `${reason}; retrying in ${Math.round(delay / 1000)}s` });
  if (spokeTimer) clearTimeout(spokeTimer);
  spokeTimer = setTimeout(() => {
    spokeTimer = null;
    void spokeConnect();
  }, delay);
}

export async function joinHotspot(info: SessionInfo, id: MeshIdentity): Promise<void> {
  const native = FieldMeshHotspot;
  if (!native || !native.isSupported()) {
    setHotspot({ role: 'error', error: 'Joining a hotspot session needs the installed FieldMesh app.' });
    return;
  }
  const inspectionId = inspectionIdFromDoc(info.doc);
  if (!inspectionId) {
    setHotspot({ role: 'error', error: 'This session code is not for an inspection.' });
    return;
  }
  await stopHotspotHost();
  await leaveHotspot();
  spokeInfo = info;
  spokeStopped = false;
  spokeAttempts = 0;
  ensureDoc(inspectionId, id, 'hotspot');
  setHotspot({ role: 'joining', joined: info, error: null, detail: info.ssid ? `Joining Wi-Fi ${info.ssid}…` : 'Connecting…' });

  hotspotSubs.push(
    native.addListener('onWifiLost', () => {
      if (spokeStopped) return;
      setHotspot({ role: 'joining', detail: 'Wi-Fi lost, rejoining…' });
      for (const lid of [...links.keys()]) if (lid.startsWith('tcp-client:')) detachLink(lid);
      void rejoinWifiThenConnect();
    })
  );
  await rejoinWifiThenConnect();
}

async function rejoinWifiThenConnect(): Promise<void> {
  const native = FieldMeshHotspot;
  if (!native || !spokeInfo || spokeStopped) return;
  const info = spokeInfo;
  if (info.ssid && info.pass) {
    try {
      await native.joinWifi(info.ssid, info.pass, 30000);
    } catch (e) {
      setHotspot({ role: 'error', error: `Could not join Wi-Fi ${info.ssid}: ${(e as Error).message}. You can also join it from the phone's Wi-Fi settings and retry.` });
      return;
    }
  }
  await spokeConnect();
}

/** Retry after a failed join (e.g. the user joined the Wi-Fi manually). */
export async function retryJoin(): Promise<void> {
  if (!spokeInfo) return;
  spokeStopped = false;
  spokeAttempts = 0;
  await spokeConnect();
}

export async function leaveHotspot(): Promise<void> {
  const native = FieldMeshHotspot;
  spokeStopped = true;
  if (spokeTimer) {
    clearTimeout(spokeTimer);
    spokeTimer = null;
  }
  const hadSpoke = spokeInfo !== null;
  spokeInfo = null;
  for (const id of [...links.keys()]) if (id.startsWith('tcp-client:')) detachLink(id);
  if (hadSpoke) {
    unsubscribeHotspot();
    try {
      await native?.leaveWifi();
    } catch {
      /* ignore */
    }
    if (docUsers.has('hotspot')) releaseDoc('hotspot');
    setHotspot({ role: 'off', joined: undefined, detail: undefined, error: null });
  }
}

export async function stopAllMesh(): Promise<void> {
  await stopMesh();
  await stopHotspotHost();
  await leaveHotspot();
}
