/**
 * The seam between this app and the server's dispute pipeline.
 *
 * Ported from app/src/editlog/editLog.ts in the backend repo (this app can't
 * import that workspace package directly). Every field edit is appended to a
 * top-level "edits" Y.Map, keyed by edit id — that's what the server's
 * edits/extract.ts walks and edits/disputes.ts compares by HLC and parents.
 * The live-displayed value goes into a separate "fields" Y.Map.
 */
import * as Y from 'yjs';
import { EditEntry } from './types';
import { HLC, encodeHlc, tick } from './hlc';

export const EDITS_MAP = 'edits';
export const FIELDS_MAP = 'fields';

export interface EditLogOptions {
  deviceId: string;
  author: string;
  schemaVersion?: number;
  newId?: () => string;
}

function defaultId(): string {
  const bytes = new Uint8Array(16);
  // eslint-disable-next-line no-undef
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class EditLog {
  private readonly doc: Y.Doc;
  private readonly deviceId: string;
  private readonly author: string;
  private readonly schemaVersion: number;
  private readonly newId: () => string;

  private hlc: HLC | null = null;

  constructor(doc: Y.Doc, options: EditLogOptions) {
    this.doc = doc;
    this.deviceId = options.deviceId;
    this.author = options.author;
    this.schemaVersion = options.schemaVersion ?? 1;
    this.newId = options.newId ?? defaultId;
  }

  private get edits(): Y.Map<unknown> {
    return this.doc.getMap(EDITS_MAP);
  }

  private get fields(): Y.Map<unknown> {
    return this.doc.getMap(FIELDS_MAP);
  }

  all(): EditEntry[] {
    const out: EditEntry[] = [];
    this.edits.forEach((v) => {
      if (v && typeof v === 'object') out.push(v as EditEntry);
    });
    return out.sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));
  }

  entriesFor(fieldId: string): EditEntry[] {
    return this.all().filter((e) => e.fieldId === fieldId);
  }

  headsFor(fieldId: string): string[] {
    const entries = this.entriesFor(fieldId);
    const superseded = new Set<string>();
    for (const e of entries) {
      for (const p of e.parents) superseded.add(p);
    }
    return entries.filter((e) => !superseded.has(e.id)).map((e) => e.id);
  }

  currentValue(fieldId: string): unknown {
    const heads = new Set(this.headsFor(fieldId));
    const candidates = this.entriesFor(fieldId).filter((e) => heads.has(e.id));
    if (candidates.length === 0) return undefined;
    return candidates.reduce((best, e) => (e.hlc > best.hlc ? e : best)).value;
  }

  set<T>(fieldId: string, value: T): EditEntry<T> {
    this.hlc = tick(this.hlc, this.deviceId);

    const entry: EditEntry<T> = {
      id: this.newId(),
      fieldId,
      value,
      author: this.author,
      device: this.deviceId,
      hlc: encodeHlc(this.hlc),
      parents: this.headsFor(fieldId),
      schemaVersion: this.schemaVersion,
    };

    this.doc.transact(() => {
      this.edits.set(entry.id, entry);
      this.fields.set(fieldId, value);
    });

    return entry;
  }

  /**
   * Local-demo only: writes an edit that forks from the same parents as the
   * current head(s) instead of superseding them, so it creates a genuine
   * concurrent dispute on a single device — standing in for a second phone
   * that edited the same field before seeing this one's latest change.
   */
  setSimulatedConcurrent<T>(fieldId: string, value: T, author: string, device: string): EditEntry<T> {
    const heads = this.headsFor(fieldId);
    const forkParents = heads.length > 0 ? this.entriesFor(fieldId).find((e) => e.id === heads[0])?.parents ?? [] : [];
    const hlc = tick(null, device);

    const entry: EditEntry<T> = {
      id: this.newId(),
      fieldId,
      value,
      author,
      device,
      hlc: encodeHlc(hlc),
      parents: forkParents,
      schemaVersion: this.schemaVersion,
    };

    this.doc.transact(() => {
      this.edits.set(entry.id, entry);
    });

    return entry;
  }

  /** Fields with more than one head — edited concurrently, not yet resolved. */
  disputedFields(): string[] {
    const byField = new Map<string, number>();
    for (const e of this.all()) byField.set(e.fieldId, 0);
    for (const fieldId of byField.keys()) byField.set(fieldId, this.headsFor(fieldId).length);
    return [...byField.entries()].filter(([, heads]) => heads > 1).map(([fieldId]) => fieldId);
  }
}
