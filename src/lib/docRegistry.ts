/**
 * Shared, ref-counted inspection documents.
 *
 * One Y.Doc per inspection lives here for as long as anything holds it: the
 * checklist screen, the dispute/report screens, the Site Session screen, or an
 * offline mesh session. Screens come and go; the document (and its cloud
 * connection, persistence and awareness) stays put, so navigating between
 * screens never reconnects, and the mesh keeps syncing after the checklist is
 * closed. A document is torn down a few seconds after its last holder leaves.
 *
 * Sync paths that write into the same doc:
 *  - Hocuspocus provider (ws://host:1234, document `inspection:<id>`, JWT)
 *  - Nearby mesh links (src/lib/mesh) — one YjsSync per peer
 *  - AsyncStorage snapshot (offline opens)
 */
import '@/lib/cryptoShim'; // must precede yjs: see cryptoShim.ts
import * as Y from 'yjs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import { EditLog, EDITS_MAP, FIELDS_MAP } from './editlog/editLog';
import { getWsUrl, onServerConfigChange } from './config';
import { getAuthToken } from './api';
import { base64ToBytes, bytesToBase64 } from './base64';
import { rememberName } from './names';
import { setMeshCloudConnected } from './mesh/meshSession';

export type SyncStatus = 'offline' | 'connecting' | 'connected' | 'unauthorized';

export interface Peer {
  clientId: number;
  userId?: string;
  name?: string;
  role?: string;
  device?: string;
  self: boolean;
}

export interface DocAuthor {
  id: string;
  name: string;
  role?: string;
}

export interface DocState {
  ready: boolean;
  status: SyncStatus;
  synced: boolean;
  unsyncedChanges: number;
  peers: Peer[];
  /** Bumps on every document change. */
  version: number;
}

export interface DocHandle {
  readonly id: string;
  readonly doc: Y.Doc;
  readonly log: EditLog;
  getState(): DocState;
  subscribe(cb: () => void): () => void;
  reconnect(): void;
  release(): void;
}

export const EMPTY_DOC_STATE: DocState = { ready: false, status: 'offline', synced: false, unsyncedChanges: 0, peers: [], version: 0 };

export function docStorageKey(inspectionId: string): string {
  return `fieldmesh:doc:${inspectionId}`;
}

const DESTROY_GRACE_MS = 8000;

class Entry {
  refs = 0;
  destroyTimer: ReturnType<typeof setTimeout> | null = null;
  persistTimer: ReturnType<typeof setTimeout> | null = null;
  state: DocState = { ...EMPTY_DOC_STATE };
  listeners = new Set<() => void>();
  doc = new Y.Doc();
  log: EditLog;
  provider: HocuspocusProvider | null = null;
  destroyed = false;

  constructor(
    readonly id: string,
    readonly deviceId: string,
    readonly author: DocAuthor
  ) {
    this.log = new EditLog(this.doc, { deviceId, author: author.id });
    const bump = () => {
      if (this.destroyed) return;
      this.patch({ version: this.state.version + 1, unsyncedChanges: this.provider?.unsyncedChanges ?? 0 });
      this.persistSoon();
    };
    this.doc.getMap(FIELDS_MAP).observe(bump);
    this.doc.getMap(EDITS_MAP).observe(bump);
    this.load();
  }

  patch(p: Partial<DocState>) {
    if (this.destroyed) return;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  private async load() {
    let saved: string | null = null;
    try {
      saved = await AsyncStorage.getItem(docStorageKey(this.id));
    } catch {
      saved = null;
    }
    if (this.destroyed) return;
    if (saved) {
      try {
        Y.applyUpdate(this.doc, base64ToBytes(saved));
      } catch {
        /* corrupt cache: rely on the server copy */
      }
    }
    this.patch({ ready: true, version: this.state.version + 1 });
    this.connect();
  }

  save() {
    try {
      AsyncStorage.setItem(docStorageKey(this.id), bytesToBase64(Y.encodeStateAsUpdate(this.doc))).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  private persistSoon() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.save(), 300);
  }

  connect() {
    this.disconnect();
    const token = getAuthToken();
    if (!token || this.destroyed) return;
    this.patch({ status: 'connecting' });
    const provider = new HocuspocusProvider({
      url: getWsUrl(),
      name: `inspection:${this.id}`,
      token,
      document: this.doc,
      onStatus: ({ status }) => {
        const s: SyncStatus =
          status === WebSocketStatus.Connected ? 'connected' : status === WebSocketStatus.Connecting ? 'connecting' : 'offline';
        this.patch({ status: s });
        setMeshCloudConnected(s === 'connected');
      },
      onSynced: ({ state }) => this.patch({ synced: !!state, unsyncedChanges: this.provider?.unsyncedChanges ?? 0 }),
      onAuthenticationFailed: () => this.patch({ status: 'unauthorized' }),
      onDisconnect: () => this.patch({ synced: false }),
      onAwarenessChange: ({ states }) => {
        const seen = new Set<string>();
        const peers: Peer[] = [];
        for (const st of states) {
          const u = (st.user ?? {}) as { id?: string; name?: string; role?: string; device?: string };
          const key = u.id ? `${u.id}|${u.device ?? ''}` : `client:${st.clientId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rememberName(u.id, u.name);
          peers.push({
            clientId: st.clientId,
            userId: u.id,
            name: u.name,
            role: u.role,
            device: u.device,
            self: u.id === this.author.id && (u.device ?? null) === this.deviceId,
          });
        }
        peers.sort((a, b) => Number(b.self) - Number(a.self));
        this.patch({ peers });
      },
    });
    this.provider = provider;
    provider.setAwarenessField('user', { id: this.author.id, name: this.author.name, role: this.author.role, device: this.deviceId });
  }

  disconnect() {
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    setMeshCloudConnected(false);
    this.patch({ status: 'offline', synced: false, peers: [] });
  }

  destroy() {
    this.destroyed = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.save();
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    setMeshCloudConnected(false);
    this.doc.destroy();
    this.listeners.clear();
  }
}

const entries = new Map<string, Entry>();

onServerConfigChange(() => {
  for (const e of entries.values()) e.connect();
});

export function acquireDoc(inspectionId: string, deviceId: string, author: DocAuthor): DocHandle {
  let entry = entries.get(inspectionId);
  if (!entry || entry.destroyed) {
    entry = new Entry(inspectionId, deviceId, author);
    entries.set(inspectionId, entry);
  }
  if (entry.destroyTimer) {
    clearTimeout(entry.destroyTimer);
    entry.destroyTimer = null;
  }
  entry.refs++;
  const e = entry;
  let released = false;
  return {
    id: inspectionId,
    doc: e.doc,
    log: e.log,
    getState: () => e.state,
    subscribe: (cb) => {
      e.listeners.add(cb);
      return () => e.listeners.delete(cb);
    },
    reconnect: () => e.connect(),
    release: () => {
      if (released) return;
      released = true;
      e.refs--;
      if (e.refs <= 0) {
        e.destroyTimer = setTimeout(() => {
          if (e.refs <= 0) {
            entries.delete(inspectionId);
            e.destroy();
          }
        }, DESTROY_GRACE_MS);
      }
    },
  };
}

/** The live document for an inspection if something currently holds it. */
export function peekDoc(inspectionId: string): Y.Doc | null {
  const e = entries.get(inspectionId);
  return e && !e.destroyed ? e.doc : null;
}
