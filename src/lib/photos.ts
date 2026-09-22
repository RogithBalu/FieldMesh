/**
 * Photo capture → SHA-256 → tus upload, matching server/src/photos/tus.ts:
 * the hash is computed over the raw file bytes (the server re-hashes what it
 * receives and rejects mismatches with 460), the upload is deduped with
 * HEAD /photos/:hash, and uploads that fail offline are queued and retried.
 */
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, authHeaders, NetworkError } from './api';
import { bytesToHex } from './base64';

export interface PhotoValue {
  hash: string;
  size: number;
  /** Local file URI on the device that took the photo (absent on other devices). */
  uri?: string;
  width?: number;
  height?: number;
  takenAt: number;
  /** Device id that captured it; other devices must fetch from the server. */
  device?: string;
}

export interface CapturedPhoto {
  value: PhotoValue;
  bytes: Uint8Array;
}

const PENDING_KEY = 'fieldmesh:pendingUploads';

interface PendingUpload {
  uri: string;
  hash: string;
  inspectionId: string;
  uploadedBy: string;
}

export async function readPhotoBytes(uri: string): Promise<Uint8Array> {
  const file = new File(uri);
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // The native module accepts a typed-array view (not a bare ArrayBuffer) over
  // a plain, non-shared buffer — same shape TextEncoder produces.
  const view = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  view.set(bytes);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, view);
  return bytesToHex(digest);
}

export type PhotoSource = 'camera' | 'library';

/** Returns null when the user cancels or denies permission. */
export async function pickPhoto(source: PhotoSource, device?: string): Promise<CapturedPhoto | null> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(source === 'camera' ? 'Camera permission denied.' : 'Photo library permission denied.');

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, exif: false };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  const bytes = await readPhotoBytes(asset.uri);
  const hash = await sha256Hex(bytes);
  return {
    bytes,
    value: {
      hash,
      size: bytes.length,
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      takenAt: Date.now(),
      device,
    },
  };
}

/**
 * Makes sure the server holds this photo. Returns 'exists' if HEAD found it,
 * 'uploaded' after a tus upload, or 'queued' if the server was unreachable
 * (the upload is retried by retryPendingUploads()).
 */
export async function ensureUploaded(
  photo: PhotoValue,
  bytes: Uint8Array | null,
  inspectionId: string,
  uploadedBy: string,
  onProgress?: (sent: number, total: number) => void
): Promise<'exists' | 'uploaded' | 'queued'> {
  try {
    if (await api.photoExists(photo.hash)) return 'exists';
    const data = bytes ?? (photo.uri ? await readPhotoBytes(photo.uri) : null);
    if (!data) throw new Error('Photo bytes are not available on this device.');
    await api.uploadPhoto({ bytes: data, hash: photo.hash, inspectionId, uploadedBy, onProgress });
    return 'uploaded';
  } catch (e) {
    if (e instanceof NetworkError && photo.uri) {
      await enqueuePending({ uri: photo.uri, hash: photo.hash, inspectionId, uploadedBy });
      return 'queued';
    }
    throw e;
  }
}

async function readPending(): Promise<PendingUpload[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) || '[]');
  } catch {
    return [];
  }
}

async function enqueuePending(p: PendingUpload): Promise<void> {
  const list = await readPending();
  if (!list.some((x) => x.hash === p.hash)) list.push(p);
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list));
}

export async function pendingUploadCount(inspectionId?: string): Promise<number> {
  const list = await readPending();
  return inspectionId ? list.filter((p) => p.inspectionId === inspectionId).length : list.length;
}

/** Retries queued uploads; returns how many were completed. Stops at the first network failure. */
export async function retryPendingUploads(inspectionId?: string): Promise<number> {
  const list = await readPending();
  let done = 0;
  const remaining: PendingUpload[] = [];
  for (const p of list) {
    if (inspectionId && p.inspectionId !== inspectionId) {
      remaining.push(p);
      continue;
    }
    try {
      if (!(await api.photoExists(p.hash))) {
        const bytes = await readPhotoBytes(p.uri);
        await api.uploadPhoto({ bytes, hash: p.hash, inspectionId: p.inspectionId, uploadedBy: p.uploadedBy });
      }
      done++;
    } catch (e) {
      remaining.push(p);
      if (e instanceof NetworkError) {
        remaining.push(...list.slice(list.indexOf(p) + 1).filter((x) => !remaining.includes(x)));
        break;
      }
    }
  }
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
  return done;
}

/** `<Image source>` for a photo: the server copy (authenticated) — GET /photos/:hash. */
export function serverPhotoSource(hash: string): { uri: string; headers: Record<string, string> } {
  return { uri: api.photoUrl(hash), headers: authHeaders() };
}

export function isPhotoValue(v: unknown): v is PhotoValue {
  return !!v && typeof v === 'object' && typeof (v as PhotoValue).hash === 'string';
}

// ── local photo metadata ─────────────────────────────────────────────────────
// The edit log stores a photo as its hash (a string), which is what the server
// persists in `edits.value` and lists in the report. The local file URI and
// dimensions only matter on the device that took it, so they live here.

export interface PhotoMeta {
  uri: string;
  size: number;
  width?: number;
  height?: number;
  takenAt: number;
}

const META_PREFIX = 'fieldmesh:photoMeta:';

export async function savePhotoMeta(hash: string, meta: PhotoMeta): Promise<void> {
  await AsyncStorage.setItem(META_PREFIX + hash, JSON.stringify(meta));
}

export async function getPhotoMeta(hash: string): Promise<PhotoMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(META_PREFIX + hash);
    return raw ? (JSON.parse(raw) as PhotoMeta) : null;
  } catch {
    return null;
  }
}

/** True for a value the checklist should treat as a photo hash. */
export function isPhotoHash(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}
