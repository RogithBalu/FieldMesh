/**
 * An inspection's live field/edit-log document, persisted on-device.
 *
 * This is the same EditLog/HLC/dispute-DAG engine the real backend uses
 * (edits/extract.ts + edits/disputes.ts), just running fully locally: the
 * Y.Doc's state is saved to AsyncStorage instead of synced to a Hocuspocus
 * server, so field edits, the audit trail, and dispute detection all work
 * offline with no network calls.
 */
import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EditLog, FIELDS_MAP, EDITS_MAP } from './editlog/editLog';
import { EditEntry } from './editlog/types';

function storageKey(inspectionId: string) {
  return `fieldmesh:doc:${inspectionId}`;
}

function bufferToBase64(buf: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return globalThis.btoa(binary);
}

function base64ToBuffer(b64: string): Uint8Array {
  const binary = globalThis.atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

export function useInspectionDoc(
  inspectionId: string | undefined,
  deviceId: string | null,
  author: string | null
) {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const editLogRef = useRef<EditLog | null>(null);
  const docRef = useRef<Y.Doc | null>(null);

  useEffect(() => {
    if (!inspectionId || !deviceId || !author) return;
    let cancelled = false;
    setReady(false);

    (async () => {
      const doc = new Y.Doc();
      const saved = await AsyncStorage.getItem(storageKey(inspectionId));
      if (saved) {
        Y.applyUpdate(doc, base64ToBuffer(saved));
      }
      if (cancelled) return;

      docRef.current = doc;
      editLogRef.current = new EditLog(doc, { deviceId, author });

      const persist = async () => {
        const state = Y.encodeStateAsUpdate(doc);
        await AsyncStorage.setItem(storageKey(inspectionId), bufferToBase64(state));
      };

      const bump = () => {
        setVersion((v) => v + 1);
        persist();
      };
      doc.getMap(FIELDS_MAP).observeDeep(bump);
      doc.getMap(EDITS_MAP).observeDeep(bump);

      setReady(true);
    })();

    return () => {
      cancelled = true;
      docRef.current?.destroy();
      docRef.current = null;
      editLogRef.current = null;
    };
  }, [inspectionId, deviceId, author]);

  return {
    ready,
    /** Bumps whenever the doc changes — read it to force a dependent re-render. */
    version,
    fieldValue: (fieldId: string): unknown => editLogRef.current?.currentValue(fieldId),
    setField: (fieldId: string, value: unknown): EditEntry | undefined =>
      editLogRef.current?.set(fieldId, value),
    entriesFor: (fieldId: string): EditEntry[] => editLogRef.current?.entriesFor(fieldId) ?? [],
    allEntries: (): EditEntry[] => editLogRef.current?.all() ?? [],
    disputedFields: (): string[] => editLogRef.current?.disputedFields() ?? [],
    simulateConcurrentEdit: (fieldId: string, value: unknown, asAuthor: string, asDevice: string) =>
      editLogRef.current?.setSimulatedConcurrent(fieldId, value, asAuthor, asDevice),
  };
}
