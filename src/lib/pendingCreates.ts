/**
 * Teams and inspections created while offline, replayed once the server is
 * reachable again.
 *
 * The phone names the record itself — `newLocalId()` — instead of waiting for
 * the server to mint an id. That is what makes offline creation possible at
 * all: an inspection needs an id before its checklist can exist, and the Yjs
 * document is keyed `inspection:<id>`. It also makes the replay idempotent,
 * since the server treats a create for an id it already holds as a no-op.
 *
 * Teams flush before inspections: an inspection created offline may belong to
 * a team created offline, and the server rejects a `teamId` it has never seen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PENDING_CREATES_KEY } from '@/constants/storageKeys';
import { api, ApiError, NetworkError } from './api';
import type { FieldType } from './editlog/types';
import { markTeamSynced } from './teamsCache';

export interface PendingTeam {
  kind: 'team';
  id: string;
  name: string;
  queuedAt: number;
}

export interface PendingInspection {
  kind: 'inspection';
  id: string;
  teamId: string;
  title: string;
  site?: string;
  schemaVersion?: number;
  fields?: { id: string; type: FieldType; tolerance?: number }[];
  queuedAt: number;
}

export type PendingCreate = PendingTeam | PendingInspection;

/** 16 random bytes as hex — the same shape editLog.ts uses for edit ids. */
export function newLocalId(): string {
  const bytes = new Uint8Array(16);
  // react-native-get-random-values is imported at the app entry point.
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function readPending(): Promise<PendingCreate[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CREATES_KEY);
    return raw ? (JSON.parse(raw) as PendingCreate[]) : [];
  } catch {
    return [];
  }
}

async function writePending(items: PendingCreate[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_CREATES_KEY, JSON.stringify(items));
  } catch {
    /* best-effort: a lost queue costs a re-create, not the local record */
  }
}

export async function enqueueCreate(item: PendingCreate): Promise<void> {
  const items = await readPending();
  await writePending([...items.filter((i) => i.id !== item.id), item]);
}

export async function pendingCount(): Promise<number> {
  return (await readPending()).length;
}

export interface FlushResult {
  sent: number;
  /** Items the server refused for good, dropped from the queue. */
  dropped: number;
  remaining: number;
}

let flushing: Promise<FlushResult> | null = null;

/**
 * Pushes every queued create. Stops at the first network failure and keeps the
 * rest for next time; a create the server refuses outright (a team that is no
 * longer ours, an id taken by someone else) is dropped, because replaying it
 * forever would block everything behind it.
 *
 * Concurrent calls share one run — reconnect events and screen focus both
 * trigger this, and two flushes would race on the same queue.
 */
export function flushPendingCreates(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = run().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function run(): Promise<FlushResult> {
  const items = await readPending();
  if (items.length === 0) return { sent: 0, dropped: 0, remaining: 0 };

  // Teams first, then oldest-first within each kind.
  const ordered = [...items].sort((a, b) =>
    a.kind === b.kind ? a.queuedAt - b.queuedAt : a.kind === 'team' ? -1 : 1
  );

  let sent = 0;
  let dropped = 0;
  const keep: PendingCreate[] = [];
  let offline = false;

  for (const item of ordered) {
    if (offline) {
      keep.push(item);
      continue;
    }
    try {
      if (item.kind === 'team') {
        await api.createTeam(item.name, item.id);
        await markTeamSynced(item.id);
      } else {
        await api.createInspection({
          id: item.id,
          teamId: item.teamId,
          title: item.title,
          site: item.site,
          schemaVersion: item.schemaVersion,
          fields: item.fields,
        });
      }
      sent += 1;
    } catch (e) {
      if (e instanceof NetworkError) {
        // Still offline. Keep this and everything after it.
        offline = true;
        keep.push(item);
      } else if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        dropped += 1;
      } else {
        keep.push(item);
      }
    }
  }

  await writePending(keep);
  return { sent, dropped, remaining: keep.length };
}
