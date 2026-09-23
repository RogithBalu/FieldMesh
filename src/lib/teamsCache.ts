/**
 * The last known team list, kept on-device so the Teams screen opens offline.
 * The screen writes it wholesale after a successful load; creating a team
 * offline upserts a single row so it is listed straight away, before its
 * queued create has reached the server.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TEAMS_CACHE_KEY } from '@/constants/storageKeys';
import type { Team } from './api';

export interface CachedTeam extends Team {
  /** True while this team exists only on this phone. */
  pending?: boolean;
}

export async function readCachedTeams(): Promise<CachedTeam[] | null> {
  try {
    const raw = await AsyncStorage.getItem(TEAMS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedTeam[]) : null;
  } catch {
    return null;
  }
}

export async function writeCachedTeams(teams: CachedTeam[]): Promise<void> {
  try {
    await AsyncStorage.setItem(TEAMS_CACHE_KEY, JSON.stringify(teams));
  } catch {
    /* cache is best-effort */
  }
}

export async function upsertCachedTeam(team: CachedTeam): Promise<void> {
  const list = (await readCachedTeams()) ?? [];
  await writeCachedTeams([team, ...list.filter((t) => t.id !== team.id)]);
}

export async function removeCachedTeam(teamId: string): Promise<void> {
  const list = await readCachedTeams();
  if (!list) return;
  await writeCachedTeams(list.filter((t) => t.id !== teamId));
}

/**
 * Drops the `pending` flag once a queued create has been accepted, so the
 * "saved on this phone" marker disappears without waiting for a full reload.
 */
export async function markTeamSynced(teamId: string): Promise<void> {
  const list = await readCachedTeams();
  if (!list) return;
  await writeCachedTeams(
    list.map((t) => (t.id === teamId ? { ...t, pending: false } : t))
  );
}
