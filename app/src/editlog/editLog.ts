/**
 * The seam between this app and the server's dispute pipeline.
 *
 * Syncing a Y.Doc is enough to keep phones agreeing with each other, but the
 * server needs more than the current value: to detect a dispute it has to see
 * that two people edited the same field without having seen each other's work.
 * A CRDT resolves that silently and keeps no record of it.
 *
 * So every field edit is also appended to a top-level "edits" Y.Map, keyed by
 * edit id. That map is what `server/src/edits/extract.ts` walks — it reads
 * `document.getMap("edits")` and expects EditEntry-shaped values — and what
 * `disputes.ts` then compares by HLC and parents.
 *
 * Appending rather than overwriting is the point: the map is a log, and the
 * `parents` of each entry are the edit ids that were current for that field
 * when this device made its change. Two entries naming the same parent are
 * concurrent, which is exactly what the server looks for.
 */

import * as Y from 'yjs';
import {EditEntry, HLC, encodeHlc, tick} from '@fieldmesh/shared';

export const EDITS_MAP = 'edits';
export const FIELDS_MAP = 'fields';

export interface EditLogOptions {
  /** Stable id for this device; becomes the HLC node and EditEntry.device. */
  deviceId: string;
  /** Who is making the edits. */
  author: string;
  schemaVersion?: number;
  /** Injectable for tests; defaults to a random id. */
  newId?: () => string;
}

function defaultId(): string {
  // Yjs already polyfills crypto for its own client ids, so this is available
  // wherever a Y.Doc can be constructed.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Writes field edits into a document in the shape the server consumes.
 *
 * One per document. Local edits go through `set`; remote edits arrive through
 * sync and are read back out by `headsFor`, so two devices editing offline both
 * name the same parent and the server can see they were concurrent.
 */
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

  /** Every edit currently in the log, oldest first by HLC. */
  all(): EditEntry[] {
    const out: EditEntry[] = [];
    this.edits.forEach((v) => {
      if (v && typeof v === 'object') {
        out.push(v as EditEntry);
      }
    });
    return out.sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));
  }

  entriesFor(fieldId: string): EditEntry[] {
    return this.all().filter((e) => e.fieldId === fieldId);
  }

  /**
   * The edit ids for this field that nothing else supersedes — the parents a
   * new edit should name.
   *
   * Two devices that both edit offline see the same heads and produce entries
   * with identical parents, which is how the server recognises a conflict
   * rather than a sequence.
   */
  headsFor(fieldId: string): string[] {
    const entries = this.entriesFor(fieldId);
    const superseded = new Set<string>();
    for (const e of entries) {
      for (const p of e.parents) {
        superseded.add(p);
      }
    }
    return entries.filter((e) => !superseded.has(e.id)).map((e) => e.id);
  }

  /** The value a field currently holds, by highest HLC among its heads. */
  currentValue(fieldId: string): unknown {
    const heads = new Set(this.headsFor(fieldId));
    const candidates = this.entriesFor(fieldId).filter((e) => heads.has(e.id));
    if (candidates.length === 0) {
      return undefined;
    }
    return candidates.reduce((best, e) => (e.hlc > best.hlc ? e : best))
      .value;
  }

  /**
   * Record a field edit: appends to the log and updates the field value.
   *
   * Both happen in one Yjs transaction so a peer never observes a value whose
   * edit has not arrived, or an edit for a value that has not landed.
   */
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
   * Fields with more than one head — edited concurrently on different devices.
   *
   * The server decides disputes authoritatively; this is the same computation
   * locally so a spoke with no connectivity can still flag them.
   */
  disputedFields(): string[] {
    const byField = new Map<string, number>();
    for (const e of this.all()) {
      byField.set(e.fieldId, 0);
    }
    for (const fieldId of byField.keys()) {
      byField.set(fieldId, this.headsFor(fieldId).length);
    }
    return [...byField.entries()]
      .filter(([, heads]) => heads > 1)
      .map(([fieldId]) => fieldId);
  }
}
