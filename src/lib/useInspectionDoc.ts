/**
 * React view of a shared inspection document (see docRegistry.ts). The screen
 * holds a reference while mounted; the document itself outlives the screen.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { acquireDoc, EMPTY_DOC_STATE, type DocAuthor, type DocHandle, type DocState, type Peer, type SyncStatus } from './docRegistry';
import type { EditEntry, FieldType } from './editlog/types';

export type { DocAuthor, Peer, SyncStatus };
export { docStorageKey } from './docRegistry';
export type FieldDefs = Record<string, { type: FieldType; tolerance?: number }>;

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

const noopSubscribe = () => () => {};
const emptyState = () => EMPTY_DOC_STATE;

export function useInspectionDoc(
  inspectionId: string | undefined,
  deviceId: string | null,
  author: DocAuthor | null,
  defs: FieldDefs
): InspectionDoc {
  const [handle, setHandle] = useState<DocHandle | null>(null);
  const defsRef = useRef<FieldDefs>(defs);
  useEffect(() => {
    defsRef.current = defs;
  }, [defs]);

  const authorId = author?.id ?? null;
  const authorName = author?.name ?? null;
  const authorRole = author?.role ?? null;

  useEffect(() => {
    if (!inspectionId || !deviceId || !authorId || !authorName) return;
    const h = acquireDoc(inspectionId, deviceId, { id: authorId, name: authorName, role: authorRole ?? undefined });
    // Publish from a microtask so the state update happens outside the effect body.
    Promise.resolve().then(() => setHandle(h));
    return () => {
      h.release();
      Promise.resolve().then(() => setHandle((cur) => (cur === h ? null : cur)));
    };
  }, [inspectionId, deviceId, authorId, authorName, authorRole]);

  const state: DocState = useSyncExternalStore(handle ? handle.subscribe : noopSubscribe, handle ? handle.getState : emptyState, emptyState);
  const log = handle?.log ?? null;
  const defOf = (fieldId: string) => defsRef.current[fieldId] ?? { type: 'short_text' as FieldType };

  return {
    ready: state.ready,
    version: state.version,
    status: state.status,
    synced: state.synced,
    unsyncedChanges: state.unsyncedChanges,
    peers: state.peers,
    fieldValue: (fieldId) => log?.currentValue(fieldId),
    setField: (fieldId, value) => log?.set(fieldId, value),
    entriesFor: (fieldId) => log?.entriesFor(fieldId) ?? [],
    headEntriesFor: (fieldId) => log?.headEntriesFor(fieldId) ?? [],
    latestFor: (fieldId) => log?.latestFor(fieldId),
    allEntries: () => log?.all() ?? [],
    evaluate: (fieldId) => {
      const d = defOf(fieldId);
      return log?.evaluate(fieldId, d.type, d.tolerance) ?? { heads: [], disputed: false, reason: '' };
    },
    disputedFields: () => log?.disputedFields(defsRef.current) ?? [],
    reconnect: () => handle?.reconnect(),
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
