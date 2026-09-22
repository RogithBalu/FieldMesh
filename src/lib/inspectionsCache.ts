/**
 * The last known inspections list, kept on-device so the list screen opens
 * offline. The list screen writes it wholesale after a successful load; the
 * create and detail screens upsert single rows so an inspection created or
 * opened while online is still listed if the app is next launched offline.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { INSPECTIONS_CACHE_KEY } from '@/constants/storageKeys';
import type { Inspection } from './api';

export interface CachedRow extends Inspection {
  teamName: string;
  completed: number;
  total: number;
  disputedCount: number;
  lastEditedAt: number;
  lastEditedBy: string | null;
}

export interface CachedList {
  rows: CachedRow[];
  hasTeams: boolean;
}

export async function readCachedList(): Promise<CachedList | null> {
  try {
    const raw = await AsyncStorage.getItem(INSPECTIONS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedList) : null;
  } catch {
    return null;
  }
}

export async function writeCachedList(list: CachedList): Promise<void> {
  try {
    await AsyncStorage.setItem(INSPECTIONS_CACHE_KEY, JSON.stringify(list));
  } catch {
    /* cache is best-effort */
  }
}

export async function upsertCachedInspection(
  row: Inspection & Partial<Omit<CachedRow, keyof Inspection>>,
  defaults: { total: number }
): Promise<void> {
  const list = (await readCachedList()) ?? { rows: [], hasTeams: true };
  const existing = list.rows.find((r) => r.id === row.id);
  const merged: CachedRow = {
    ...(existing ?? {
      teamName: row.teamName ?? 'Team',
      completed: 0,
      total: defaults.total,
      disputedCount: 0,
      lastEditedAt: row.created_at,
      lastEditedBy: null,
    }),
    ...existing,
    ...row,
    teamName: row.teamName ?? existing?.teamName ?? 'Team',
  };
  list.rows = [merged, ...list.rows.filter((r) => r.id !== row.id)];
  list.hasTeams = true;
  await writeCachedList(list);
}
