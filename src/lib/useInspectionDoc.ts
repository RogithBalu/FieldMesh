/**
 * An inspection's live document: a Y.Doc holding the "fields" and "edits"
 * maps, synced through the server's Hocuspocus endpoint (ws://host:1234,
 * document `inspection:<id>`, JWT as the provider token) and mirrored to
 * AsyncStorage so the checklist opens and accepts edits offline. Reconnecting
 * replays queued changes; the server extracts edits and recomputes disputes.
 *
 * Awareness carries {id, name, role, device} so teammates on the same
 * inspection show up as "on site" peers and their names can be displayed.
 */
import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import { EditLog, EDITS_MAP, FIELDS_MAP } from './editlog/editLog';
import type { EditEntry, FieldType } from './editlog/types';
import { getWsUrl, onServerConfigChange } from './config';
import { getAuthToken } from './api';
import { base64ToBytes, bytesToBase64 } from './base64';
import { rememberName } from './names';

export type SyncStatus = 'offline' | 'connecting' | 'connected' | 'unauthorized';
export type FieldDefs = Record<string, { type: FieldType; tolerance?: number }>;

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

export function docStorageKey(inspectionId: string): string {
  return `fieldmesh:doc:${inspectionId}`;
}

interface SessionState {
  key: string;
  ready: boolean;
  status: SyncStatus;
  synced: boolean;
  unsyncedChanges: number;
  peers: Peer[];
}

const INITIAL: Omit<SessionState, 'key'> = { ready: false, status: 'offline', synced: false, unsyncedChanges: 0, peers: [] };

export interface InspectionDoc {
  ready: boolean;
  /** Bumps whenever the doc changes — read it to force a dependent re-render. */
  version: number;
  status: SyncStatus;
  synced: boolean;
  unsyncedChanges: number;
  peers: Peer[];
  fieldValue: (fieldId: string) => unknown;
  setField: (fieldId: string, value: unknown) => EditEntry | undefined;
  entriesFor: (fieldId: string) => EditEntry[];
  headEntriesFor: (fieldId: string) => EditEntry[];
  latestFor: (fieldId: string) => EditEntry | undefined;
  allEntries: () => EditEntry[];
  evaluate: (fieldId: string) => { heads: EditEntry[]; disputed: boolean; reason: string };
  disputedFields: () => string[];
  reconnect: () => void;
}

export function useInspectionDoc(
  inspectionId: string | undefined,
  deviceId: string | null,
  author: DocAuthor | null,
  defs: FieldDefs
): InspectionDoc {
  const [version, setVersion] = useState(0);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [session, setSession] = useState<SessionState>({ key: '', ...INITIAL });

  const docRef = useRef<Y.Doc | null>(null);
  const logRef = useRef<EditLog | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const defsRef = useRef<FieldDefs>(defs);

  useEffect(() => {
    defsRef.current = defs;
  }, [defs]);

  const authorId = author?.id ?? null;
  const authorName = author?.name ?? null;
  const authorRole = author?.role ?? null;

  // A session is one (inspection, connection attempt); state from a previous
  // session is discarded by key comparison instead of reset inside the effect.
  const key = `${inspectionId ?? ''}|${reconnectKey}`;
  const current: SessionState = session.key === key ? session : { key, ...INITIAL };

  useEffect(() => onServerConfigChange(() => setReconnectKey((k) => k + 1)), []);

  useEffect(() => {
    if (!inspectionId || !deviceId || !authorId) return;
    let cancelled = false;
    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    const patch = (p: Partial<Omit<SessionState, 'key'>>) => {
      if (cancelled) return;
      setSession((prev) => ({ ...(prev.key === key ? prev : { key, ...INITIAL }), ...p, key }));
    };

    const doc = new Y.Doc();
    const log = new EditLog(doc, { deviceId, author: authorId });
    docRef.current = doc;
    logRef.current = log;

    const save = () => {
      try {
        AsyncStorage.setItem(docStorageKey(inspectionId), bytesToBase64(Y.encodeStateAsUpdate(doc))).catch(() => {});
      } catch {
        /* ignore */
      }
    };
    const persistSoon = () => {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(save, 300);
    };
    const bump = () => {
      if (cancelled) return;
      setVersion((v) => v + 1);
      patch({ unsyncedChanges: providerRef.current?.unsyncedChanges ?? 0 });
      persistSoon();
    };
    doc.getMap(FIELDS_MAP).observe(bump);
    doc.getMap(EDITS_MAP).observe(bump);

    let provider: HocuspocusProvider | null = null;

    (async () => {
      let saved: string | null = null;
      try {
        saved = await AsyncStorage.getItem(docStorageKey(inspectionId));
      } catch {
        saved = null;
      }
      if (cancelled) return;
      if (saved) {
        try {
          Y.applyUpdate(doc, base64ToBytes(saved));
        } catch {
          /* corrupt cache: start from the server copy */
        }
      }
      setVersion((v) => v + 1);
      patch({ ready: true });

      const token = getAuthToken();
      if (!token) return;
      patch({ status: 'connecting' });
      provider = new HocuspocusProvider({
        url: getWsUrl(),
        name: `inspection:${inspectionId}`,
        token,
        document: doc,
        onStatus: ({ status: s }) => {
          patch({
            status:
              s === WebSocketStatus.Connected ? 'connected' : s === WebSocketStatus.Connecting ? 'connecting' : 'offline',
          });
        },
        onSynced: ({ state }) => {
          patch({ synced: !!state, unsyncedChanges: providerRef.current?.unsyncedChanges ?? 0 });
        },
        onAuthenticationFailed: () => patch({ status: 'unauthorized' }),
        onDisconnect: () => patch({ synced: false }),
        onAwarenessChange: ({ states }) => {
          // One person can hold the document open from several screens/tabs; show each user+device once.
          const seen = new Set<string>();
          const peers: Peer[] = [];
          for (const st of states) {
            const u = (st.user ?? {}) as { id?: string; name?: string; role?: string; device?: string };
            const dedupeKey = u.id ? `${u.id}|${u.device ?? ''}` : `client:${st.clientId}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            rememberName(u.id, u.name);
            peers.push({
              clientId: st.clientId,
              userId: u.id,
              name: u.name,
              role: u.role,
              device: u.device,
              self: u.id === authorId && (u.device ?? null) === deviceId,
            });
          }
          peers.sort((a, b) => Number(b.self) - Number(a.self));
          patch({ peers });
        },
      });
      providerRef.current = provider;
      provider.setAwarenessField('user', { id: authorId, name: authorName, role: authorRole, device: deviceId });
    })();

    return () => {
      cancelled = true;
      if (persistTimer) clearTimeout(persistTimer);
      save();
      providerRef.current = null;
      provider?.destroy();
      doc.destroy();
      docRef.current = null;
      logRef.current = null;
    };
  }, [inspectionId, deviceId, authorId, authorName, authorRole, reconnectKey, key]);

  const defOf = (fieldId: string) => defsRef.current[fieldId] ?? { type: 'short_text' as FieldType };

  return {
    ready: current.ready,
    version,
    status: current.status,
    synced: current.synced,
    unsyncedChanges: current.unsyncedChanges,
    peers: current.peers,
    fieldValue: (fieldId) => logRef.current?.currentValue(fieldId),
    setField: (fieldId, value) => logRef.current?.set(fieldId, value),
    entriesFor: (fieldId) => logRef.current?.entriesFor(fieldId) ?? [],
    headEntriesFor: (fieldId) => logRef.current?.headEntriesFor(fieldId) ?? [],
    latestFor: (fieldId) => logRef.current?.latestFor(fieldId),
    allEntries: () => logRef.current?.all() ?? [],
    evaluate: (fieldId) => {
      const d = defOf(fieldId);
      return logRef.current?.evaluate(fieldId, d.type, d.tolerance) ?? { heads: [], disputed: false, reason: '' };
    },
    disputedFields: () => logRef.current?.disputedFields(defsRef.current) ?? [],
    reconnect: () => setReconnectKey((k) => k + 1),
  };
}

/** Field definitions for an inspection: the server's field_defs if present, else the checklist template. */
export function defsFrom(
  serverFields: { id: string; type: FieldType; tolerance: number | null }[] | undefined,
  fallback: FieldDefs
): FieldDefs {
  if (!serverFields || serverFields.length === 0) return fallback;
  const out: FieldDefs = {};
  for (const f of serverFields) out[f.id] = { type: f.type, tolerance: f.tolerance ?? undefined };
  return out;
}
