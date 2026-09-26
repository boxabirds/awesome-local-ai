import {
  MAX_REMEMBERED_WORKSPACES,
  REMEMBERED_COOKIE_MAX_AGE_S,
  REMEMBERED_COOKIE_NAME,
} from '@todoodle/shared/limits';
import { z } from 'zod';
import type { Env } from '../env.ts';
import { isWellFormedSecret } from './crypto.ts';

/** One remembered workspace: its id, its secret and when this browser last opened it (unix seconds). */
export type RememberedEntry = { id: string; s: string; t: number };

const ID_BYTES = 16;
const SECRET_BYTES = 32;
const TIME_BYTES = 4;
const ENTRY_BYTES = ID_BYTES + SECRET_BYTES + TIME_BYTES;
/** First byte of the encoded value; bump it if the layout ever changes (old cookies then decode to []). */
const FORMAT_VERSION = 1;

const ID_PATTERN = /^[0-9A-F]{32}$/;

export const RememberedEntrySchema = z.object({
  id: z.string().regex(ID_PATTERN),
  s: z.string().refine(isWellFormedSecret),
  t: z.number().int().min(0).max(0xffff_ffff),
});

/*
 * Encoding: base64url of a packed binary list, most recent first:
 *   [version:1] then per entry [id:16 bytes][secret:32 bytes][t:uint32 BE].
 * A JSON encoding would exceed the 4096-byte cookie limit at MAX_REMEMBERED_WORKSPACES entries
 * (about 6.5 KB); this one stays around 3.5 KB. See NOTES.md.
 */

function toBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex.toUpperCase();
}

/** The cookie value for a list of entries. Invalid entries are skipped. */
export function encodeRemembered(entries: RememberedEntry[]): string {
  const valid = entries.filter((entry) => RememberedEntrySchema.safeParse(entry).success);
  const out = new Uint8Array(1 + valid.length * ENTRY_BYTES);
  const view = new DataView(out.buffer);
  out[0] = FORMAT_VERSION;
  valid.forEach((entry, i) => {
    const offset = 1 + i * ENTRY_BYTES;
    out.set(hexToBytes(entry.id), offset);
    const secret = fromBase64url(entry.s);
    if (secret) out.set(secret, offset + ID_BYTES);
    view.setUint32(offset + ID_BYTES + SECRET_BYTES, entry.t);
  });
  return toBase64url(out);
}

/**
 * Entries from a cookie value, or null when the value as a whole cannot be decoded (bad base64, wrong
 * version, truncated). Never throws. Individually invalid or duplicate entries are dropped.
 */
export function decodeRememberedStrict(value: string): RememberedEntry[] | null {
  const bytes = fromBase64url(value);
  if (!bytes || bytes.length < 1 || bytes[0] !== FORMAT_VERSION || (bytes.length - 1) % ENTRY_BYTES !== 0) return null;
  const view = new DataView(bytes.buffer);
  const entries: RememberedEntry[] = [];
  for (let offset = 1; offset < bytes.length; offset += ENTRY_BYTES) {
    const entry = {
      id: bytesToHex(bytes.subarray(offset, offset + ID_BYTES)),
      s: toBase64url(bytes.subarray(offset + ID_BYTES, offset + ID_BYTES + SECRET_BYTES)),
      t: view.getUint32(offset + ID_BYTES + SECRET_BYTES),
    };
    if (RememberedEntrySchema.safeParse(entry).success && !entries.some((e) => e.id === entry.id)) entries.push(entry);
  }
  return entries;
}

/** Entries from a cookie value. Never throws: anything unparseable is []. Invalid entries are dropped individually. */
export function decodeRemembered(value: string): RememberedEntry[] {
  return decodeRememberedStrict(value) ?? [];
}

/** The value of the remembered cookie in a Cookie header, if any. */
function cookieValue(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** This browser's remembered workspaces from the request's Cookie header. Never throws; malformed -> []. */
export function readRemembered(cookieHeader: string | null): RememberedEntry[] {
  const parsed = parseRememberedCookie(cookieHeader);
  return parsed.status === 'ok' ? parsed.entries : [];
}

export type ParsedRememberedCookie =
  | { status: 'absent' }
  | { status: 'ok'; entries: RememberedEntry[] }
  | { status: 'malformed' };

/** Like readRemembered, but tells an absent cookie apart from a malformed one (which the caller heals). */
export function parseRememberedCookie(cookieHeader: string | null): ParsedRememberedCookie {
  const value = cookieHeader ? cookieValue(cookieHeader, REMEMBERED_COOKIE_NAME) : undefined;
  if (!value) return { status: 'absent' };
  const entries = decodeRememberedStrict(value);
  return entries ? { status: 'ok', entries } : { status: 'malformed' };
}

/**
 * Puts `entry` first (replacing any entry with the same id) and caps the list at `max`,
 * dropping the oldest. `dropped` is how many entries the cap removed.
 */
export function upsertRemembered(
  entries: RememberedEntry[],
  entry: RememberedEntry,
  max = MAX_REMEMBERED_WORKSPACES,
): { entries: RememberedEntry[]; dropped: number } {
  const merged = [entry, ...entries.filter((e) => e.id !== entry.id)];
  const kept = merged.slice(0, max);
  return { entries: kept, dropped: merged.length - kept.length };
}

function cookieAttributes(env: Pick<Env, 'ENVIRONMENT'>, maxAge: number): string[] {
  const attributes = ['HttpOnly', 'SameSite=Lax', 'Path=/api', `Max-Age=${maxAge}`];
  // Secure on staging and production. Only local wrangler dev (plain http) omits it; an unknown
  // environment fails safe to Secure.
  if (env.ENVIRONMENT !== 'local') attributes.push('Secure');
  return attributes;
}

/**
 * The one builder for every tdl_ws Set-Cookie: HttpOnly (never readable by page scripts), SameSite=Lax,
 * Path=/api (sent only to the API), Max-Age=REMEMBERED_COOKIE_MAX_AGE_S, and Secure on staging/production.
 */
export function rememberedCookieHeader(value: string, env: Pick<Env, 'ENVIRONMENT'>): string {
  return [`${REMEMBERED_COOKIE_NAME}=${value}`, ...cookieAttributes(env, REMEMBERED_COOKIE_MAX_AGE_S)].join('; ');
}

/** Deletes the cookie (same name, path and attributes, Max-Age=0). Used to heal a malformed value. */
export function clearRememberedCookieHeader(env: Pick<Env, 'ENVIRONMENT'>): string {
  return [`${REMEMBERED_COOKIE_NAME}=`, ...cookieAttributes(env, 0)].join('; ');
}

/** The full Set-Cookie header value for a list of entries. */
export function serializeRememberedCookie(entries: RememberedEntry[], env: Pick<Env, 'ENVIRONMENT'>): string {
  return rememberedCookieHeader(encodeRemembered(entries), env);
}

/**
 * Open by id: moves the entry for `id` to the front with t = nowSec, keeping its secret.
 * Null when the id is not remembered (touch never adds an entry).
 */
export function touchRemembered(entries: RememberedEntry[], id: string, nowSec: number): RememberedEntry[] | null {
  const entry = findEntry(entries, id);
  if (!entry) return null;
  return upsertRemembered(entries, { id, s: entry.s, t: nowSec }).entries;
}

/** Forget on this browser: removes the entry for `id`, keeping the order of the rest. */
export function removeRemembered(entries: RememberedEntry[], id: string): { entries: RememberedEntry[]; changed: boolean } {
  const kept = entries.filter((entry) => entry.id !== id);
  return { entries: kept, changed: kept.length !== entries.length };
}

export function findEntry(entries: RememberedEntry[], id: string): RememberedEntry | undefined {
  return entries.find((entry) => entry.id === id);
}
