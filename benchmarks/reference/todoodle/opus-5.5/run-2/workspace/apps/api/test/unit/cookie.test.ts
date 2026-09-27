import { MAX_REMEMBERED_WORKSPACES, REMEMBERED_COOKIE_MAX_AGE_S } from '@todoodle/shared/limits';
import { describe, expect, it } from 'vitest';
import {
  encodeRemembered,
  findEntry,
  readRemembered,
  type RememberedEntry,
  serializeRememberedCookie,
  upsertRemembered,
} from '../../src/lib/cookie';
import { generateSecret } from '../../src/lib/crypto';

const T0 = 1_790_000_000;

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function entries(count: number): RememberedEntry[] {
  return Array.from({ length: count }, (_, i) => ({ id: randomId(), s: generateSecret(), t: T0 - i }));
}

/** Cookie request header from a Set-Cookie value. */
function asCookieHeader(setCookie: string): string {
  return setCookie.split(';')[0]!;
}

const LOCAL = { ENVIRONMENT: 'local' };

function toBase64url(text: string): string {
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

describe('remembered-workspaces cookie codec', () => {
  it.each([0, 1, 49, 50])('TC-07 encode then decode round-trips %i entries exactly', (count) => {
    const list = entries(count);
    const header = asCookieHeader(serializeRememberedCookie(list, LOCAL));
    expect(readRemembered(header)).toEqual(list);
    expect(readRemembered(`other=1; ${header}; more=2`)).toEqual(list);
  });

  it.each([
    ['no header', null],
    ['empty header', ''],
    ['no tdl_ws cookie', 'other=abc'],
    ['empty value', 'tdl_ws='],
    ['bad base64', 'tdl_ws=%%%not-base64%%%'],
    ['impossible base64 length', 'tdl_ws=A'],
    ['base64url of broken JSON', `tdl_ws=${toBase64url('[{"id":"abc",')}`],
    ['base64url of JSON (wrong shape)', `tdl_ws=${toBase64url(JSON.stringify({ id: 'x' }))}`],
    [
      'base64url of JSON with missing fields',
      `tdl_ws=${toBase64url(JSON.stringify([{ id: '0'.repeat(32) }]))}`,
    ],
    ['wrong format version', `tdl_ws=${toBase64url(`\u0002${'x'.repeat(52)}`)}`],
    ['truncated entry', `tdl_ws=${encodeRemembered(entries(2)).slice(0, -10)}`],
  ])('TC-08 malformed (%s) decodes to [] without throwing', (_label, header) => {
    expect(() => readRemembered(header)).not.toThrow();
    expect(readRemembered(header)).toEqual([]);
  });

  it('TC-08 entries that cannot be encoded are dropped individually', () => {
    const good = entries(2);
    const bad = [
      { id: 'not-hex', s: generateSecret(), t: T0 },
      { id: randomId(), s: 'short', t: T0 },
      { id: randomId(), s: generateSecret(), t: 1.5 },
    ];
    const header = asCookieHeader(serializeRememberedCookie([good[0]!, ...bad, good[1]!], LOCAL));
    expect(readRemembered(header)).toEqual(good);
  });

  it('TC-09 upsert of a new entry puts it first with its t, length + 1', () => {
    const list = entries(3);
    const entry = { id: randomId(), s: generateSecret(), t: T0 + 100 };
    const result = upsertRemembered(list, entry);
    expect(result.entries).toHaveLength(4);
    expect(result.entries[0]).toEqual(entry);
    expect(result.entries.slice(1)).toEqual(list);
    expect(result.dropped).toBe(0);
  });

  it('TC-09 upsert into an empty list', () => {
    const entry = { id: randomId(), s: generateSecret(), t: T0 };
    expect(upsertRemembered([], entry)).toEqual({ entries: [entry], dropped: 0 });
  });

  it('TC-10 upsert of an existing entry moves it to the front, updates t, no duplicate', () => {
    const list = entries(4);
    const existing = list[2]!;
    const result = upsertRemembered(list, { ...existing, t: T0 + 500 });
    expect(result.entries).toHaveLength(4);
    expect(result.entries[0]).toEqual({ ...existing, t: T0 + 500 });
    expect(result.entries.filter((e) => e.id === existing.id)).toHaveLength(1);
    expect(result.entries.slice(1)).toEqual([list[0], list[1], list[3]]);
    expect(result.dropped).toBe(0);
  });

  it('TC-11 upsert of a new entry at the cap keeps 50, drops the oldest, dropped = 1', () => {
    const list = entries(MAX_REMEMBERED_WORKSPACES);
    const entry = { id: randomId(), s: generateSecret(), t: T0 + 1 };
    const result = upsertRemembered(list, entry);
    expect(result.entries).toHaveLength(MAX_REMEMBERED_WORKSPACES);
    expect(result.entries[0]).toEqual(entry);
    expect(findEntry(result.entries, list.at(-1)!.id)).toBeUndefined();
    expect(result.dropped).toBe(1);
  });

  it('TC-11 upsert at 49 entries reaches 50 with nothing dropped', () => {
    const result = upsertRemembered(entries(49), { id: randomId(), s: generateSecret(), t: T0 });
    expect(result.entries).toHaveLength(50);
    expect(result.dropped).toBe(0);
  });

  it('TC-11 moving an existing entry at the cap drops nothing', () => {
    const list = entries(MAX_REMEMBERED_WORKSPACES);
    const result = upsertRemembered(list, { ...list[10]!, t: T0 + 9 });
    expect(result.entries).toHaveLength(MAX_REMEMBERED_WORKSPACES);
    expect(result.dropped).toBe(0);
  });

  it('TC-12 the full Set-Cookie string at 50 entries is under 4096 bytes', () => {
    const header = serializeRememberedCookie(entries(MAX_REMEMBERED_WORKSPACES), { ENVIRONMENT: 'production' });
    expect(new TextEncoder().encode(header).byteLength).toBeLessThan(4096);
  });

  it('TC-13 attributes: HttpOnly, SameSite=Lax, Path=/api, Max-Age; Secure unless local', () => {
    const attrs = (env: { ENVIRONMENT?: string }) =>
      serializeRememberedCookie(entries(1), env)
        .split(';')
        .slice(1)
        .map((a) => a.trim());
    const base = ['HttpOnly', 'SameSite=Lax', 'Path=/api', `Max-Age=${REMEMBERED_COOKIE_MAX_AGE_S}`];
    expect(REMEMBERED_COOKIE_MAX_AGE_S).toBe(34_560_000);
    expect(attrs(LOCAL)).toEqual(base);
    expect(attrs({ ENVIRONMENT: 'staging' })).toEqual([...base, 'Secure']);
    expect(attrs({ ENVIRONMENT: 'production' })).toEqual([...base, 'Secure']);
    expect(attrs({})).toEqual([...base, 'Secure']);
    expect(serializeRememberedCookie([], LOCAL).startsWith('tdl_ws=')).toBe(true);
  });

  it('findEntry finds by id', () => {
    const list = entries(3);
    expect(findEntry(list, list[1]!.id)).toEqual(list[1]);
    expect(findEntry(list, randomId())).toBeUndefined();
  });
});
