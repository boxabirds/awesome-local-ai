import { MAX_REMEMBERED_WORKSPACES, REMEMBERED_COOKIE_MAX_AGE_S } from '@todoodle/shared/limits';
import { describe, expect, it } from 'vitest';
import {
  type RememberedEntry,
  decodeRemembered,
  encodeRemembered,
  findEntry,
  readRemembered,
  serializeRememberedCookie,
  upsertRemembered,
} from '../../src/lib/cookie.ts';
import { generateSecret } from '../../src/lib/crypto.ts';

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Entries with real secrets and ids; index 0 is the most recent. */
function entries(count: number, now = 1_790_000_000): RememberedEntry[] {
  return Array.from({ length: count }, (_, i) => ({ id: randomId(), s: generateSecret(), t: now - i }));
}

function base64url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function cookieHeaderFor(list: RememberedEntry[]): string {
  const setCookie = serializeRememberedCookie(list, { ENVIRONMENT: 'local' });
  return setCookie.split(';')[0]!;
}

describe('workspace.cookie_codec', () => {
  it.each([0, 1, 49, 50])('TC-07 encode then decode round-trips %i entries exactly', (count) => {
    const list = entries(count);
    expect(decodeRemembered(encodeRemembered(list))).toEqual(list);
    expect(readRemembered(`other=1; ${cookieHeaderFor(list)}; more=2`)).toEqual(list);
  });

  it('TC-08 malformed values decode to [] without throwing', () => {
    const one = entries(1);
    const valid = encodeRemembered(one);
    const malformed = [
      '%%%not-base64%%%',
      'a', // not decodable base64
      base64url('{not json'), // broken JSON
      base64url(JSON.stringify(one)), // JSON (wrong shape for this codec)
      base64url(JSON.stringify([{ id: one[0]!.id }])), // missing fields
      valid.slice(0, -4), // truncated
      `B${valid.slice(1)}`, // wrong version byte
      '',
    ];
    for (const value of malformed) {
      expect(() => decodeRemembered(value)).not.toThrow();
      expect(decodeRemembered(value)).toEqual([]);
      expect(readRemembered(`tdl_ws=${value}`)).toEqual([]);
    }
    expect(readRemembered(null)).toEqual([]);
    expect(readRemembered('')).toEqual([]);
    expect(readRemembered('unrelated=1')).toEqual([]);
  });

  it('TC-08 invalid entries are dropped individually when encoding', () => {
    const [good] = entries(1);
    const list = [good!, { id: 'not-hex', s: generateSecret(), t: 1 }, { id: randomId(), s: 'short', t: 1 }];
    expect(decodeRemembered(encodeRemembered(list))).toEqual([good]);
  });

  it('TC-09 upsert of a new entry puts it first with its t, length +1', () => {
    const list = entries(3);
    const entry = { id: randomId(), s: generateSecret(), t: 1_800_000_000 };
    const result = upsertRemembered(list, entry);
    expect(result.entries).toEqual([entry, ...list]);
    expect(result.dropped).toBe(0);
  });

  it('TC-10 upsert of an existing entry moves it to the front, updates t, no duplicate', () => {
    const list = entries(3);
    const moved = { ...list[2]!, t: 1_800_000_000 };
    const result = upsertRemembered(list, moved);
    expect(result.entries).toEqual([moved, list[0], list[1]]);
    expect(result.entries.filter((e) => e.id === moved.id)).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });

  it('TC-11 upsert of a new entry at the cap keeps 50, drops the oldest, dropped=1', () => {
    const list = entries(MAX_REMEMBERED_WORKSPACES);
    const entry = { id: randomId(), s: generateSecret(), t: 1_800_000_000 };
    const result = upsertRemembered(list, entry);
    expect(result.entries).toHaveLength(50);
    expect(result.entries[0]).toEqual(entry);
    expect(result.entries).not.toContainEqual(list[49]);
    expect(result.dropped).toBe(1);
    // 49 -> 50 is not a drop; 51 existing (e.g. an old larger cap) drops two.
    expect(upsertRemembered(entries(49), entry).dropped).toBe(0);
    expect(upsertRemembered(entries(51), entry).dropped).toBe(2);
  });

  it('TC-12 the full Set-Cookie string at 50 entries is under 4096 bytes', () => {
    const header = serializeRememberedCookie(entries(50), { ENVIRONMENT: 'production' });
    expect(new TextEncoder().encode(header).byteLength).toBeLessThan(4096);
  });

  it('TC-13 cookie attributes; Secure unless ENVIRONMENT=local', () => {
    const list = entries(1);
    for (const env of ['staging', 'production', undefined]) {
      const header = serializeRememberedCookie(list, { ENVIRONMENT: env });
      const parts = header.split('; ');
      expect(parts[0]).toBe(`tdl_ws=${encodeRemembered(list)}`);
      expect(parts.slice(1)).toEqual(['HttpOnly', 'SameSite=Lax', 'Path=/api', `Max-Age=${REMEMBERED_COOKIE_MAX_AGE_S}`, 'Secure']);
    }
    expect(REMEMBERED_COOKIE_MAX_AGE_S).toBe(34_560_000);
    const local = serializeRememberedCookie(list, { ENVIRONMENT: 'local' }).split('; ');
    expect(local.slice(1)).toEqual(['HttpOnly', 'SameSite=Lax', 'Path=/api', 'Max-Age=34560000']);
  });

  it('findEntry finds by id', () => {
    const list = entries(3);
    expect(findEntry(list, list[1]!.id)).toEqual(list[1]);
    expect(findEntry(list, randomId())).toBeUndefined();
  });
});
