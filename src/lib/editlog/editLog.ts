/**
 * The seam between this app and the server's dispute pipeline.
 *
 * Port of app/src/editlog/editLog.ts from the FieldMesh backend repo. Every
 * field edit is appended to a top-level "edits" Y.Map keyed by edit id — the
 * exact shape server/src/edits/extract.ts walks and edits/disputes.ts compares
 * by HLC and `parents`. The live-displayed value goes into a separate "fields"
 * Y.Map. Appending (not overwriting) is the point: two entries naming the same
 * parent were made concurrently, which is what the server flags as a dispute.
 */
import * as Y from 'yjs';
import type { EditEntry, FieldType } from './types';
import { HLC, compare, decodeHlc, encodeHlc, tick } from './hlc';
import { mergeConcurrent } from './rules';

export const EDITS_MAP = 'edits';
export const FIELDS_MAP = 'fields';

export interface EditLogOptions {
  /** Stable id for this device; becomes the HLC node and EditEntry.device. */
  deviceId: string;
  /** Who is making the edits (the server uses the user id as author too). */
  author: string;
  schemaVersion?: number;
  newId?: () => string;
}

function defaultId(): string {
  const bytes = new Uint8Array(16);
  // react-native-get-random-values is imported at the app entry point.
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function byHlc(a: EditEntry, b: EditEntry): number {
  return compare(decodeHlc(a.hlc), decodeHlc(b.hlc));
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

  /** Every edit currently in the log, oldest first by HLC. */
  all(): EditEntry[] {
    const out: EditEntry[] = [];
    this.edits.forEach((v) => {
      if (v && typeof v === 'object' && typeof (v as EditEntry).hlc === 'string') {
        out.push(v as EditEntry);
      }
    });
    return out.sort(byHlc);
  }

  entriesFor(fieldId: string): EditEntry[] {
    return this.all().filter((e) => e.fieldId === fieldId);
  }

  /**
   * Edit ids for this field that nothing supersedes — the parents a new edit
   * should name. Remote edits arriving via sync count too, so two devices that
   * both edited offline produce entries with identical parents.
   */
  headsFor(fieldId: string): string[] {
    return this.headEntriesFor(fieldId).map((e) => e.id);
  }

  headEntriesFor(fieldId: string): EditEntry[] {
    const entries = this.entriesFor(fieldId);
    const superseded = new Set<string>();
    for (const e of entries) {
      for (const p of e.parents ?? []) superseded.add(p);
    }
    return entries.filter((e) => !superseded.has(e.id));
  }

  /** The value a field currently holds, by highest HLC among its heads. */
  currentValue(fieldId: string): unknown {
    const heads = this.headEntriesFor(fieldId);
    if (heads.length === 0) return undefined;
    return heads.reduce((best, e) => (byHlc(e, best) > 0 ? e : best)).value;
  }

  /** Newest edit for a field regardless of head status (for "last edited"). */
  latestFor(fieldId: string): EditEntry | undefined {
    const entries = this.entriesFor(fieldId);
    return entries[entries.length - 1];
  }

  /** Bumps the local clock past a remote edit so later edits order after it. */
  observe(remote: EditEntry): void {
    const r = decodeHlc(remote.hlc);
    if (!this.hlc || compare(r, this.hlc) > 0) {
      this.hlc = { wall: r.wall, counter: r.counter, node: this.deviceId };
    }
  }

  set<T>(fieldId: string, value: T): EditEntry<T> {
    // Never go backwards relative to the newest edit we've seen for the field.
    const latest = this.latestFor(fieldId);
    if (latest) this.observe(latest);
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
   * Same merge decision the server makes for a field with more than one head.
   * `fieldType`/`tolerance` come from the inspection's field definitions.
   */
  evaluate(fieldId: string, fieldType: FieldType, tolerance?: number) {
    const heads = this.headEntriesFor(fieldId);
    if (heads.length <= 1) return { heads, disputed: false, reason: '' };
    const result = mergeConcurrent(fieldType, heads, tolerance);
    return { heads, disputed: result.disputed, reason: result.reason };
  }

  /** Fields whose concurrent heads the merge rules leave unresolved. */
  disputedFields(defs: Record<string, { type: FieldType; tolerance?: number }>): string[] {
    const fieldIds = new Set(this.all().map((e) => e.fieldId));
    const out: string[] = [];
    for (const fieldId of fieldIds) {
      const def = defs[fieldId] ?? { type: 'short_text' as FieldType };
      if (this.evaluate(fieldId, def.type, def.tolerance).disputed) out.push(fieldId);
    }
    return out;
  }
}
