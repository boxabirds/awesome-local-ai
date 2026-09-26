import { MAX_REMEMBERED_WORKSPACES, REMEMBERED_COOKIE_MAX_AGE_S } from '@todoodle/shared/limits';
import { describe, expect, it } from 'vitest';
import {
  type RememberedEntry,
  clearRememberedCookieHeader,
  rememberedCookieHeader,
  removeRemembered,
  touchRemembered,
  upsertRemembered,
} from '../../src/lib/cookie.ts';
import { generateSecret } from '../../src/lib/crypto.ts';
import { toPublic } from '../../src/lib/remembered.ts';

const NOW = 1_790_000_000;

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function entry(t = NOW - 100): RememberedEntry {
  return { id: randomId(), s: generateSecret(), t };
}

/** `count` real entries, most recent first (index 0 newest). */
function entries(count: number): RememberedEntry[] {
  return Array.from({ length: count }, (_, i) => entry(NOW - 1000 - i));
}

const ids = (list: RememberedEntry[]) => list.map((e) => e.id);

describe('remembered.touch', () => {
  it('TC-01 upsert into an empty list: [] -> [A], A.t = now, dropped 0', () => {
    const before: RememberedEntry[] = [];
    const a = entry();
    const result = upsertRemembered(before, { ...a, t: NOW });
    expect(before).toEqual([]);
    expect(result.entries).toEqual([{ id: a.id, s: a.s, t: NOW }]);
    expect(result.dropped).toBe(0);
  });

  it('TC-02 upsert existing A in [B, A] -> [A, B], A.t updated, no duplicate', () => {
    const a = entry(NOW - 500);
    const b = entry(NOW - 100);
    const before = [b, a];
    const snapshot = structuredClone(before);
    const result = upsertRemembered(before, { id: a.id, s: a.s, t: NOW });
    expect(before).toEqual(snapshot);
    expect(result.entries).toEqual([{ id: a.id, s: a.s, t: NOW }, b]);
    expect(result.dropped).toBe(0);

    // touchRemembered reuses upsert with the stored secret and never adds unknown ids.
    expect(touchRemembered(before, a.id, NOW)).toEqual([{ id: a.id, s: a.s, t: NOW }, b]);
    expect(touchRemembered(before, randomId(), NOW)).toBeNull();
    expect(before).toEqual(snapshot);
  });
});

describe('remembered.cap_notice', () => {
  it('TC-03 49 entries + new -> 50, dropped 0', () => {
    const before = entries(49);
    const fresh = entry(NOW);
    const result = upsertRemembered(before, fresh);
    expect(before).toHaveLength(49);
    expect(result.entries).toHaveLength(50);
    expect(ids(result.entries)).toEqual([fresh.id, ...ids(before)]);
    expect(result.dropped).toBe(0);
  });

  it('TC-04 50 entries + new -> stays 50, oldest removed, dropped 1', () => {
    expect(MAX_REMEMBERED_WORKSPACES).toBe(50);
    const before = entries(50);
    const fresh = entry(NOW);
    const result = upsertRemembered(before, fresh);
    expect(result.entries).toHaveLength(50);
    expect(ids(result.entries)).toEqual([fresh.id, ...ids(before).slice(0, 49)]);
    expect(ids(result.entries)).not.toContain(before[49]!.id);
    expect(result.dropped).toBe(1);
  });

  it('TC-05 50 entries + existing one -> length 50, order changed, dropped 0', () => {
    const before = entries(50);
    const moved = before[30]!;
    const result = upsertRemembered(before, { ...moved, t: NOW });
    expect(result.entries).toHaveLength(50);
    expect(result.entries[0]).toEqual({ ...moved, t: NOW });
    expect(ids(result.entries)).toEqual([moved.id, ...ids(before).filter((id) => id !== moved.id)]);
    expect(result.dropped).toBe(0);
  });
});

describe('remembered.forget_api', () => {
  it('TC-06 [A, B, C] remove B -> [A, C], order preserved', () => {
    const [a, b, c] = entries(3) as [RememberedEntry, RememberedEntry, RememberedEntry];
    const before = [a, b, c];
    const result = removeRemembered(before, b.id);
    expect(result).toEqual({ entries: [a, c], changed: true });
    expect(before).toEqual([a, b, c]);
  });

  it('TC-07 [A] remove Z -> unchanged, changed=false', () => {
    const before = entries(1);
    const result = removeRemembered(before, randomId());
    expect(result).toEqual({ entries: before, changed: false });
  });
});

describe('remembered.list_api', () => {
  it('TC-08 projection has exactly id, name, lastOpenedAt, available (never the secret)', () => {
    const e = entry(NOW);
    const available = toPublic(e, { name: 'Groceries 🛒 Café' });
    expect(Object.keys(available).sort()).toEqual(['available', 'id', 'lastOpenedAt', 'name']);
    expect(available).toEqual({ id: e.id, name: 'Groceries 🛒 Café', lastOpenedAt: new Date(NOW * 1000).toISOString(), available: true });
    const unavailable = toPublic(e, null);
    expect(Object.keys(unavailable).sort()).toEqual(['available', 'id', 'lastOpenedAt', 'name']);
    expect(unavailable).toMatchObject({ name: null, available: false });
    for (const view of [available, unavailable]) expect(JSON.stringify(view)).not.toContain(e.s);
  });
});

describe('remembered.cookie_attributes', () => {
  const BASE = ['HttpOnly', 'SameSite=Lax', 'Path=/api', `Max-Age=${REMEMBERED_COOKIE_MAX_AGE_S}`];

  it.each([
    ['local', BASE],
    ['staging', [...BASE, 'Secure']],
    ['production', [...BASE, 'Secure']],
  ])('TC-09 ENVIRONMENT=%s', (environment, expected) => {
    const parts = rememberedCookieHeader('VALUE', { ENVIRONMENT: environment }).split('; ');
    expect(parts[0]).toBe('tdl_ws=VALUE');
    expect(parts.slice(1)).toEqual(expected);
  });

  it('TC-10 the clear builder uses Max-Age=0 with the same name and path', () => {
    for (const environment of ['local', 'staging', 'production']) {
      const parts = clearRememberedCookieHeader({ ENVIRONMENT: environment }).split('; ');
      expect(parts[0]).toBe('tdl_ws=');
      expect(parts).toContain('Path=/api');
      expect(parts).toContain('HttpOnly');
      expect(parts).toContain('SameSite=Lax');
      expect(parts).toContain('Max-Age=0');
      expect(parts.includes('Secure')).toBe(environment !== 'local');
    }
  });
});
