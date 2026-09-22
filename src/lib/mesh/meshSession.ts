/**
 * The offline site mesh for one inspection.
 *
 * Every participating phone advertises AND discovers under a service id
 * derived from the inspection id, auto-accepts links, and runs one YjsSync per
 * link on the inspection's shared Y.Doc (from docRegistry). Because that same
 * document is what the Hocuspocus provider syncs when a phone has internet,
 * any phone with a connection relays the whole mesh to the cloud — and the
 * cloud's edits back — with no extra forwarding code.
 *
 * Duplicate links are avoided with a deterministic tie-break: of two phones
 * that discover each other, only the one with the smaller device suffix
 * initiates the connection (the other side just accepts).
 */
import type { EventSubscription } from 'expo-modules-core';
import FieldMeshNearby from '../../../modules/fieldmesh-nearby';
import { acquireDoc, type DocHandle } from '../docRegistry';
import { rememberName } from '../names';
import { bytesToUtf8, utf8ToBytes } from '../base64';
import { Msg } from './framing';
import { NearbyTransport } from './nearbyTransport';
import { YjsSync } from './yjsSync';
import { requestMeshPermissions } from './permissions';

export type MeshMedium = 'bluetooth-le' | 'bluetooth' | 'wifi' | 'unknown';
export type MeshStatus = 'unavailable' | 'off' | 'starting' | 'searching' | 'linked' | 'error';

export interface MeshPeer {
  endpointId: string;
  endpointName: string;
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

export interface MeshState {
  status: MeshStatus;
  inspectionId: string | null;
  peers: MeshPeer[];
  discovered: { endpointId: string; name: string }[];
  error: string | null;
  startedAt: number | null;
}

interface Link {
  transport: NearbyTransport;
  sync: YjsSync;
  peer: MeshPeer;
}

const listeners = new Set<() => void>();
let state: MeshState = { status: FieldMeshNearby ? 'off' : 'unavailable', inspectionId: null, peers: [], discovered: [], error: null, startedAt: null };
let handle: DocHandle | null = null;
let identity: MeshIdentity | null = null;
let subs: EventSubscription[] = [];
const links = new Map<string, Link>();
let cloudConnected = false;

function setState(patch: Partial<MeshState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
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

/** Called by the doc registry so peers learn whether we can relay them to the cloud. */
export function setMeshCloudConnected(connected: boolean) {
  if (cloudConnected === connected) return;
  cloudConnected = connected;
  for (const link of links.values()) sendHello(link.sync);
}

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

function sendHello(sync: YjsSync) {
  if (!identity) return;
  const hello = { u: identity.userId, n: identity.name, r: identity.role, d: identity.deviceId, c: cloudConnected };
  sync.sendFrame(Msg.HELLO, utf8ToBytes(JSON.stringify(hello)));
}

function publishPeers() {
  setState({ peers: [...links.values()].map((l) => l.peer), status: links.size > 0 ? 'linked' : state.status === 'off' ? 'off' : 'searching' });
}

function attachLink(endpointId: string, endpointName: string) {
  if (!handle || links.has(endpointId)) return;
  const transport = new NearbyTransport(endpointId);
  const sync = new YjsSync(handle.doc, transport);
  const peer: MeshPeer = { endpointId, endpointName, name: endpointName.split('#')[0], medium: 'unknown', linkedAt: Date.now() };
  const link: Link = { transport, sync, peer };
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
    if (status === 'closed' || status === 'error') detachLink(endpointId);
  });
  links.set(endpointId, link);
  sync.start();
  sendHello(sync);
  publishPeers();
}

function detachLink(endpointId: string) {
  const link = links.get(endpointId);
  if (!link) return;
  link.sync.stop();
  links.delete(endpointId);
  link.transport.close().catch(() => {});
  publishPeers();
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
  if (state.inspectionId === inspectionId && state.status !== 'off' && state.status !== 'error') return;
  await stopMesh();

  setState({ status: 'starting', inspectionId, error: null, discovered: [], startedAt: Date.now() });
  const perm = await requestMeshPermissions();
  if (!perm.granted) {
    setState({ status: 'error', error: `Permission needed: ${perm.missing.join(', ')}` });
    return;
  }

  identity = id;
  handle = acquireDoc(inspectionId, id.deviceId, { id: id.userId, name: id.name, role: id.role });
  const native = FieldMeshNearby;
  const myName = endpointNameFor(id);
  const serviceId = serviceIdFor(inspectionId);

  subs.push(
    native.addListener('onEndpointFound', (e) => {
      if (e.serviceId && e.serviceId !== serviceId) return;
      setState({ discovered: [...state.discovered.filter((d) => d.endpointId !== e.endpointId), { endpointId: e.endpointId, name: e.name }] });
      // Tie-break so only one side dials.
      if (suffixOf(myName) < suffixOf(e.name) && !links.has(e.endpointId)) {
        native.requestConnection(myName, e.endpointId).catch((err: Error) => {
          setState({ error: `Connect to ${e.name.split('#')[0]} failed: ${err.message}` });
        });
      }
    }),
    native.addListener('onEndpointLost', (e) => {
      setState({ discovered: state.discovered.filter((d) => d.endpointId !== e.endpointId) });
    }),
    native.addListener('onConnected', (e) => attachLink(e.endpointId, e.name)),
    native.addListener('onDisconnected', (e) => detachLink(e.endpointId)),
    native.addListener('onBandwidthChanged', (e) => {
      const link = links.get(e.endpointId);
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
  for (const id of [...links.keys()]) detachLink(id);
  for (const s of subs) s.remove();
  subs = [];
  try {
    await FieldMeshNearby?.stopAll();
  } catch {
    /* ignore */
  }
  handle?.release();
  handle = null;
  identity = null;
  setState({ status: FieldMeshNearby ? 'off' : 'unavailable', inspectionId: null, peers: [], discovered: [], startedAt: null });
}

export function meshLabel(medium: MeshMedium): string {
  switch (medium) {
    case 'wifi':
      return 'Wi-Fi Direct / hotspot';
    case 'bluetooth':
      return 'Bluetooth';
    case 'bluetooth-le':
      return 'Bluetooth LE';
    default:
      return 'Nearby (negotiating)';
  }
}
