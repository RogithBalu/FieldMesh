/**
 * Typed client for every FieldMesh server route (server/src/<area>/routes.ts):
 *
 *   GET  /health
 *   POST /auth/signup   POST /auth/login   POST /auth/refresh   GET /auth/me
 *   GET  /teams         POST /teams        POST /teams/:id/members
 *   GET  /inspections   POST /inspections  GET  /inspections/:id
 *   GET  /inspections/:id/history          GET  /inspections/:id/disputes
 *   POST /inspections/:id/resolve          GET  /inspections/:id/report
 *   POST /inspections/:id/finalize         POST /inspections/:id/reopen
 *   HEAD /photos/:hash  GET  /photos/:hash
 *   POST /uploads, PATCH/HEAD /uploads/:id   (tus resumable upload)
 *
 * Live document sync (Hocuspocus on port 1234) lives in useInspectionDoc.ts.
 */
import { fetch as expoFetch } from 'expo/fetch';
import { getApiUrl } from './config';
import { stringToBase64 } from './base64';
import type { FieldType } from './editlog/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(message = 'Cannot reach the FieldMesh server.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export type Role = 'technician' | 'supervisor' | 'auditor';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Team {
  id: string;
  name: string;
}

export interface FieldDefRow {
  id: string;
  type: FieldType;
  tolerance: number | null;
}

export interface Inspection {
  id: string;
  team_id: string;
  title: string;
  site: string | null;
  created_by: string;
  created_at: number;
  schema_version: number;
  /** Present on GET /inspections/:id (servers with field-definition support). */
  fields?: FieldDefRow[];
  /** Epoch ms of sign-off, or null/absent while the inspection is open. */
  finalized_at?: number | null;
  /** User id of the reviewer who signed it off. */
  finalized_by?: string | null;
}

export interface FinalizeResult {
  finalizedAt: number;
  finalizedBy: string;
  /** True when the reviewer signed off over unsettled disputes. */
  forcedOverDisputes: boolean;
}

export interface ReopenResult {
  reopenedBy: string;
  wasFinalizedAt: number;
  wasFinalizedBy: string | null;
  /** Edits that arrived while the inspection was closed, still excluded. */
  lateEdits: number;
}

/**
 * Who may settle a dispute or sign an inspection off. Mirrors REVIEWER_ROLES
 * on the server, which enforces it for real — this only shapes the UI, since a
 * phone's own claim about its role cannot be trusted.
 */
export function canReview(role: Role | undefined): boolean {
  return role === 'supervisor' || role === 'auditor';
}

/** Only an auditor may re-open, so a supervisor cannot undo their own sign-off. */
export function canReopen(role: Role | undefined): boolean {
  return role === 'auditor';
}

export interface EditRow {
  edit_id: string;
  inspection_id: string;
  field_id: string;
  value: string | null;
  author: string;
  device: string;
  hlc: string;
  parents: string | null;
  schema_version: number;
  disputed: number;
}

export interface ReportHead {
  editId: string;
  value: string | null;
  author: string;
  device: string;
  hlc: string;
}

export interface ReportField {
  value: string | null;
  disputed: boolean;
  heads: ReportHead[];
  lastEditedBy: string;
  lastEditedAt: number;
  edits: number;
}

export interface ReportPhoto {
  hash: string;
  size: number;
  uploadedBy: string;
  verifiedAt: number | null;
}

export interface Report {
  inspection: Inspection;
  generatedAt: number;
  fields: Record<string, ReportField>;
  photos: ReportPhoto[];
  summary: { edits: number; fields: number; disputedFields: number; photos: number };
}

export interface AuthResponse {
  token: string;
  user: User;
}

// ── token + connectivity state ───────────────────────────────────────────────

let authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  authToken = token;
}
export function getAuthToken(): string | null {
  return authToken;
}

type ConnectivityListener = (online: boolean) => void;
const connectivityListeners = new Set<ConnectivityListener>();
let lastOnline: boolean | null = null;

export function onConnectivity(cb: ConnectivityListener): () => void {
  connectivityListeners.add(cb);
  return () => connectivityListeners.delete(cb);
}

function reportConnectivity(online: boolean) {
  if (lastOnline === online) return;
  lastOnline = online;
  connectivityListeners.forEach((l) => l(online));
}

// ── core request helper ──────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15000;

interface RequestOptions {
  json?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
  timeoutMs?: number;
  baseUrl?: string;
}

interface RawResponse {
  status: number;
  headers: Headers;
  body: any;
  text: string;
}

export function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

async function request(method: string, path: string, opts: RequestOptions = {}): Promise<RawResponse> {
  const base = (opts.baseUrl ?? getApiUrl()).replace(/\/+$/, '');
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  if (opts.auth !== false && authToken) headers.Authorization = `Bearer ${authToken}`;
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body, signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    reportConnectivity(false);
    const err = e as Error | undefined;
    if (__DEV__) console.log(`[api] ${method} ${base}${path} failed:`, err?.name, err?.message);
    throw new NetworkError(
      err?.name === 'AbortError'
        ? 'Server timed out.'
        : `Cannot reach the FieldMesh server${err?.message ? ` (${err.message})` : ''}.`
    );
  }
  clearTimeout(timer);
  reportConnectivity(true);

  const text = method === 'HEAD' ? '' : await res.text();
  let parsed: any = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, headers: res.headers, body: parsed, text };
}

function expectOk<T>(res: RawResponse, ...okStatuses: number[]): T {
  const ok = okStatuses.length ? okStatuses.includes(res.status) : res.status >= 200 && res.status < 300;
  if (!ok) {
    const msg =
      (res.body && typeof res.body === 'object' && typeof res.body.error === 'string' && res.body.error) ||
      (typeof res.body === 'string' && res.body) ||
      `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, res.body);
  }
  return res.body as T;
}

// ── endpoints ────────────────────────────────────────────────────────────────

export const api = {
  /** GET /health — also usable against an arbitrary base URL to test a server before switching to it. */
  async health(baseUrl?: string): Promise<{ ok: boolean; service: string }> {
    const res = await request('GET', '/health', { auth: false, timeoutMs: 6000, baseUrl });
    return expectOk(res);
  },

  // auth
  async signup(input: { email: string; name: string; password: string; role?: Role }): Promise<AuthResponse> {
    const res = await request('POST', '/auth/signup', { json: input, auth: false });
    return expectOk(res, 201, 200);
  },
  async login(input: { email: string; password: string }): Promise<AuthResponse> {
    const res = await request('POST', '/auth/login', { json: input, auth: false });
    return expectOk(res, 200);
  },
  async refresh(): Promise<AuthResponse> {
    const res = await request('POST', '/auth/refresh');
    return expectOk(res, 200);
  },
  async me(): Promise<{ user: User }> {
    const res = await request('GET', '/auth/me');
    return expectOk(res, 200);
  },

  // teams
  async listTeams(): Promise<Team[]> {
    const res = await request('GET', '/teams');
    return expectOk(res, 200);
  },
  async createTeam(name: string): Promise<{ id: string }> {
    const res = await request('POST', '/teams', { json: { name } });
    return expectOk(res, 200, 201);
  },
  async addTeamMember(teamId: string, userId: string): Promise<void> {
    const res = await request('POST', `/teams/${encodeURIComponent(teamId)}/members`, { json: { userId } });
    expectOk(res, 204, 200);
  },

  // inspections
  async listInspections(): Promise<Inspection[]> {
    const res = await request('GET', '/inspections');
    return expectOk(res, 200);
  },
  async createInspection(input: {
    teamId: string;
    title: string;
    site?: string;
    schemaVersion?: number;
    fields?: { id: string; type: FieldType; tolerance?: number }[];
  }): Promise<{ id: string }> {
    const res = await request('POST', '/inspections', { json: input });
    return expectOk(res, 200, 201);
  },
  async getInspection(id: string): Promise<Inspection> {
    const res = await request('GET', `/inspections/${encodeURIComponent(id)}`);
    return expectOk(res, 200);
  },
  async history(id: string): Promise<EditRow[]> {
    const res = await request('GET', `/inspections/${encodeURIComponent(id)}/history`);
    return expectOk(res, 200);
  },
  async disputes(id: string): Promise<EditRow[]> {
    const res = await request('GET', `/inspections/${encodeURIComponent(id)}/disputes`);
    return expectOk(res, 200);
  },
  async resolve(
    id: string,
    input: { fieldId: string; value: unknown; device: string; schemaVersion?: number }
  ): Promise<{ editId: string }> {
    const res = await request('POST', `/inspections/${encodeURIComponent(id)}/resolve`, { json: input });
    return expectOk(res, 200);
  },
  /**
   * Sign the inspection off. The server refuses while any field is still
   * disputed unless `force` is set, and refuses outright for a technician.
   */
  async finalize(id: string, input?: { force?: boolean }): Promise<FinalizeResult> {
    const res = await request('POST', `/inspections/${encodeURIComponent(id)}/finalize`, {
      json: input ?? {},
    });
    return expectOk(res, 200);
  },
  /** Auditor-only: reverse a sign-off so the checklist accepts edits again. */
  async reopen(id: string): Promise<ReopenResult> {
    const res = await request('POST', `/inspections/${encodeURIComponent(id)}/reopen`, { json: {} });
    return expectOk(res, 200);
  },
  async report(id: string): Promise<Report> {
    const res = await request('GET', `/inspections/${encodeURIComponent(id)}/report`);
    return expectOk(res, 200);
  },

  // photos
  async photoExists(hash: string): Promise<boolean> {
    const res = await request('HEAD', `/photos/${encodeURIComponent(hash)}`);
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw new ApiError(res.status, `HEAD /photos failed (${res.status})`);
  },
  photoUrl(hash: string): string {
    return `${getApiUrl()}/photos/${encodeURIComponent(hash)}`;
  },

  /**
   * Resumable photo upload via tus (POST /uploads → PATCH /uploads/:id).
   * Metadata contract from server/src/photos/tus.ts: hash, inspectionId,
   * uploadedBy. The server re-hashes the bytes and answers 460 on mismatch.
   * Resumes from the server's reported offset if a chunk fails mid-way.
   */
  async uploadPhoto(input: {
    bytes: Uint8Array;
    hash: string;
    inspectionId: string;
    uploadedBy: string;
    onProgress?: (sent: number, total: number) => void;
  }): Promise<void> {
    const base = getApiUrl();
    const { bytes, hash, inspectionId, uploadedBy } = input;
    const meta = Object.entries({ hash, inspectionId, uploadedBy })
      .map(([k, v]) => `${k} ${stringToBase64(v)}`)
      .join(',');

    const create = await request('POST', '/uploads', {
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(bytes.length),
        'Upload-Metadata': meta,
      },
      timeoutMs: 20000,
    });
    if (create.status !== 201) {
      throw new ApiError(create.status, `Upload could not be created (${create.status})`, create.body);
    }
    const location = create.headers.get('location') ?? '';
    if (!location) throw new ApiError(500, 'Upload created without a Location header');
    const uploadPath = location.replace(/^https?:\/\/[^/]+/, '');
    const uploadUrl = `${base}${uploadPath.startsWith('/') ? uploadPath : `/${uploadPath}`}`;

    const CHUNK = 512 * 1024;
    let offset = 0;
    let attempts = 0;
    while (offset < bytes.length) {
      const end = Math.min(offset + CHUNK, bytes.length);
      let res: Response;
      try {
        res = await expoFetch(uploadUrl, {
          method: 'PATCH',
          headers: {
            ...authHeaders(),
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': String(offset),
            'Content-Type': 'application/offset+octet-stream',
          },
          body: bytes.slice(offset, end),
        });
      } catch {
        if (++attempts > 3) throw new NetworkError('Upload interrupted.');
        offset = await tusOffset(uploadUrl);
        continue;
      }
      if (res.status === 460) throw new ApiError(460, 'Server rejected photo: checksum mismatch.');
      if (res.status === 409) {
        // Offset conflict: ask the server where it actually is and continue.
        offset = await tusOffset(uploadUrl);
        continue;
      }
      if (res.status !== 204) {
        const txt = await res.text().catch(() => '');
        throw new ApiError(res.status, txt || `Upload failed (${res.status})`);
      }
      offset = Number(res.headers.get('upload-offset') ?? end);
      input.onProgress?.(offset, bytes.length);
    }
  },
};

async function tusOffset(uploadUrl: string): Promise<number> {
  const res = await fetch(uploadUrl, {
    method: 'HEAD',
    headers: { ...authHeaders(), 'Tus-Resumable': '1.0.0' },
  });
  const off = Number(res.headers.get('upload-offset') ?? '0');
  return Number.isFinite(off) ? off : 0;
}

/** Human-readable message for any error thrown by the client. */
export function errorMessage(e: unknown, fallback = 'Something went wrong.'): string {
  if (e instanceof ApiError || e instanceof NetworkError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
