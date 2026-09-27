import { MAX_REMEMBERED_WORKSPACES, REMEMBERED_COOKIE_MAX_AGE_S } from '@todoodle/shared/limits';
import type { Env } from '../env';

/** One workspace this browser remembers: id, secret, and last-opened time (unix seconds). */
export type RememberedEntry = { id: string; s: string; t: number };

export const REMEMBERED_COOKIE_NAME = 'tdl_ws';

/*
 * Encoding: base64url of a packed binary list, most recent first.
 *   [format version: 1 byte] then per entry [id: 16 bytes][secret: 32 bytes][t: uint32 BE].
 * base64url(JSON) of 50 entries is ~7 KB, over the 4096-byte cookie limit; this packing is 3.5 KB.
 */
const FORMAT_VERSION = 1;
const ID_BYTES = 16;
const SECRET_BYTES = 32;
const ENTRY_BYTES = ID_BYTES + SECRET_BYTES + 4;
const HEX_ID = /^[0-9a-f]{32}$/;

function toBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Throws on anything that is not base64url. */
function fromBase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('not base64url');
  if (value.length % 4 === 1) throw new Error('not base64url');
  const b64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function hexToBytes(hex: string, out: Uint8Array, offset: number): void {
  for (let i = 0; i < hex.length / 2; i++) out[offset + i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** A secret that packs losslessly into 32 bytes (the canonical base64url form generateSecret makes). */
function secretBytes(secret: string): Uint8Array | null {
  try {
    const bytes = fromBase64url(secret);
    return bytes.byteLength === SECRET_BYTES && toBase64url(bytes) === secret ? bytes : null;
  } catch {
    return null;
  }
}

function isPackable(e: RememberedEntry): boolean {
  return HEX_ID.test(e.id) && Number.isInteger(e.t) && e.t >= 0 && e.t <= 0xffffffff && secretBytes(e.s) !== null;
}

function cookieValue(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function encodeRemembered(entries: RememberedEntry[]): string {
  const packable = entries.filter(isPackable);
  const out = new Uint8Array(1 + packable.length * ENTRY_BYTES);
  const view = new DataView(out.buffer);
  out[0] = FORMAT_VERSION;
  packable.forEach((e, i) => {
    const offset = 1 + i * ENTRY_BYTES;
    hexToBytes(e.id, out, offset);
    out.set(secretBytes(e.s)!, offset + ID_BYTES);
    view.setUint32(offset + ID_BYTES + SECRET_BYTES, e.t);
  });
  return toBase64url(out);
}

export function decodeRemembered(value: string): RememberedEntry[] {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64url(value);
  } catch {
    return [];
  }
  if (bytes.byteLength < 1 || bytes[0] !== FORMAT_VERSION || (bytes.byteLength - 1) % ENTRY_BYTES !== 0) {
    return [];
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: RememberedEntry[] = [];
  for (let offset = 1; offset < bytes.byteLength; offset += ENTRY_BYTES) {
    entries.push({
      id: bytesToHex(bytes.subarray(offset, offset + ID_BYTES)),
      s: toBase64url(bytes.subarray(offset + ID_BYTES, offset + ID_BYTES + SECRET_BYTES)),
      t: view.getUint32(offset + ID_BYTES + SECRET_BYTES),
    });
  }
  return entries;
}

/** Entries from the Cookie header, most recent first. Never throws: garbage reads as []. */
export function readRemembered(cookieHeader: string | null): RememberedEntry[] {
  if (!cookieHeader) return [];
  const raw = cookieValue(cookieHeader, REMEMBERED_COOKIE_NAME);
  return raw ? decodeRemembered(raw) : [];
}

/** Puts `entry` first (replacing any entry with the same id) and caps the list at `max`. */
export function upsertRemembered(
  entries: RememberedEntry[],
  entry: RememberedEntry,
  max = MAX_REMEMBERED_WORKSPACES,
): { entries: RememberedEntry[]; dropped: number } {
  const next = [entry, ...entries.filter((e) => e.id !== entry.id)];
  const dropped = Math.max(0, next.length - max);
  return { entries: next.slice(0, max), dropped };
}

/** The full Set-Cookie value for the remembered list. */
export function serializeRememberedCookie(
  entries: RememberedEntry[],
  env: Pick<Env, 'ENVIRONMENT'>,
): string {
  const attributes = ['HttpOnly', 'SameSite=Lax', 'Path=/api', `Max-Age=${REMEMBERED_COOKIE_MAX_AGE_S}`];
  if (env.ENVIRONMENT !== 'local') attributes.push('Secure');
  return `${REMEMBERED_COOKIE_NAME}=${encodeRemembered(entries)}; ${attributes.join('; ')}`;
}

export function findEntry(entries: RememberedEntry[], id: string): RememberedEntry | undefined {
  return entries.find((e) => e.id === id);
}
