/**
 * Fully local, on-device data layer. No network calls anywhere in this file.
 *
 * Mirrors the shape of the real FieldMesh backend (users/teams/inspections,
 * password hashing, team-membership scoping) so the app's logic and screens
 * match what a real deployment would do — it just persists to AsyncStorage
 * on this device instead of a server. Per-inspection edit history and
 * dispute detection live in each inspection's Y.Doc (see useInspectionDoc),
 * not here — same split as the real backend (SQL identity tables vs. the
 * Yjs edit log).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const KEYS = {
  users: 'fieldmesh:users',
  teams: 'fieldmesh:teams',
  inspections: 'fieldmesh:inspections',
} as const;

export class LocalDbError extends Error {}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'technician' | 'supervisor' | 'auditor';
  passwordHash: string;
}

export type PublicUser = Omit<User, 'passwordHash'>;

export interface Team {
  id: string;
  name: string;
  memberIds: string[];
}

export interface Inspection {
  id: string;
  teamId: string;
  title: string;
  site: string | null;
  createdBy: string;
  createdAt: number;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function readList<T>(key: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T[]) : [];
}

async function writeList<T>(key: string, list: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(list));
}

async function hashPassword(password: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, password);
}

function toPublic(u: User): PublicUser {
  const { passwordHash, ...rest } = u;
  return rest;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function signup(input: {
  email: string;
  name: string;
  password: string;
  role?: User['role'];
}): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.name.trim()) throw new LocalDbError('Name and email are required.');
  if (input.password.length < 8) throw new LocalDbError('Password must be at least 8 characters.');

  const users = await readList<User>(KEYS.users);
  if (users.some((u) => u.email === email)) {
    throw new LocalDbError('An account with this email already exists on this device.');
  }

  const user: User = {
    id: newId('user'),
    name: input.name.trim(),
    email,
    role: input.role ?? 'technician',
    passwordHash: await hashPassword(input.password),
  };
  users.push(user);
  await writeList(KEYS.users, users);
  return toPublic(user);
}

export async function login(email: string, password: string): Promise<PublicUser> {
  const users = await readList<User>(KEYS.users);
  const user = users.find((u) => u.email === email.trim().toLowerCase());
  if (!user) throw new LocalDbError('No account with that email on this device.');
  const hash = await hashPassword(password);
  if (hash !== user.passwordHash) throw new LocalDbError('Incorrect password.');
  return toPublic(user);
}

export async function getUser(userId: string): Promise<PublicUser | undefined> {
  const users = await readList<User>(KEYS.users);
  const user = users.find((u) => u.id === userId);
  return user ? toPublic(user) : undefined;
}

export async function findUserByEmail(email: string): Promise<PublicUser | undefined> {
  const users = await readList<User>(KEYS.users);
  const user = users.find((u) => u.email === email.trim().toLowerCase());
  return user ? toPublic(user) : undefined;
}

// ── Teams ────────────────────────────────────────────────────────────────────

export async function listTeamsFor(userId: string): Promise<Team[]> {
  const teams = await readList<Team>(KEYS.teams);
  return teams.filter((t) => t.memberIds.includes(userId));
}

export async function createTeam(name: string, creatorId: string): Promise<Team> {
  if (!name.trim()) throw new LocalDbError('Team name is required.');
  const teams = await readList<Team>(KEYS.teams);
  const team: Team = { id: newId('team'), name: name.trim(), memberIds: [creatorId] };
  teams.push(team);
  await writeList(KEYS.teams, teams);
  return team;
}

export async function addTeamMember(teamId: string, callerId: string, memberEmail: string): Promise<void> {
  const teams = await readList<Team>(KEYS.teams);
  const team = teams.find((t) => t.id === teamId);
  if (!team) throw new LocalDbError('Team not found.');
  if (!team.memberIds.includes(callerId)) throw new LocalDbError('Only existing members can add someone.');

  const member = await findUserByEmail(memberEmail);
  if (!member) throw new LocalDbError('No account with that email on this device.');
  if (!team.memberIds.includes(member.id)) team.memberIds.push(member.id);
  await writeList(KEYS.teams, teams);
}

export async function isTeamMember(teamId: string, userId: string): Promise<boolean> {
  const teams = await readList<Team>(KEYS.teams);
  return !!teams.find((t) => t.id === teamId)?.memberIds.includes(userId);
}

// ── Inspections ──────────────────────────────────────────────────────────────

export async function listInspectionsFor(userId: string): Promise<Inspection[]> {
  const [inspections, myTeams] = await Promise.all([
    readList<Inspection>(KEYS.inspections),
    listTeamsFor(userId),
  ]);
  const myTeamIds = new Set(myTeams.map((t) => t.id));
  return inspections
    .filter((i) => myTeamIds.has(i.teamId))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createInspection(input: {
  teamId: string;
  title: string;
  site?: string;
  createdBy: string;
}): Promise<Inspection> {
  if (!input.title.trim()) throw new LocalDbError('Title is required.');
  const inspections = await readList<Inspection>(KEYS.inspections);
  const inspection: Inspection = {
    id: newId('insp'),
    teamId: input.teamId,
    title: input.title.trim(),
    site: input.site?.trim() || null,
    createdBy: input.createdBy,
    createdAt: Date.now(),
  };
  inspections.push(inspection);
  await writeList(KEYS.inspections, inspections);
  return inspection;
}

export async function getInspection(id: string): Promise<Inspection | undefined> {
  const inspections = await readList<Inspection>(KEYS.inspections);
  return inspections.find((i) => i.id === id);
}
