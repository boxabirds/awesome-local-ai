import { MAX_REMEMBERED_WORKSPACES, REMEMBERED_COOKIE_MAX_AGE_S } from '@todoodle/shared/limits';
import { RememberedPublic } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import {
  clearRememberedCookieHeader,
  type RememberedEntry,
  rememberedCookieHeader,
  removeRemembered,
  touchRemembered,
  upsertRemembered,
} from '../../src/lib/cookie';
import { generateSecret } from '../../src/lib/crypto';
import { toPublic } from '../../src/lib/remembered';

const NOW = 1_790_000_000;

function hexId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function entry(t = NOW - 100): RememberedEntry {
  return { id: hexId(), s: generateSecret(), t };
}

/** `count` entries, most recent first (t descending). */
function entries(count: number): RememberedEntry[] {
  return Array.from({ length: count }, (_, i) => entry(NOW - 1000 - i));
}

const snapshot = (list: RememberedEntry[]) => structuredClone(list);

describe('remembered ordering (remembered.touch)', () => {
  it('TC-01 upsert into an empty list: [] -> [A], A.t = now, dropped 0', () => {
    const before: RememberedEntry[] = [];
    const a = { id: hexId(), s: generateSecret(), t: NOW };
    const result = upsertRemembered(before, a);
    expect(before).toEqual([]);
    expect(result).toEqual({ entries: [a], dropped: 0 });
    expect(result.entries[0]!.t).toBe(NOW);
  });

  it('TC-02 [B, A] upsert A -> [A, B], A.t updated, no duplicate', () => {
    const a = entry(NOW - 500);
    const b = entry(NOW - 100);
    const before = [b, a];
    const copy = snapshot(before);
    const result = upsertRemembered(before, { ...a, t: NOW });
    expect(before).toEqual(copy);
    expect(result.entries).toEqual([{ ...a, t: NOW }, b]);
    expect(result.dropped).toBe(0);
  });

  it('TC-02 touchRemembered moves the entry to the front keeping its secret; unknown id -> null', () => {
    const a = entry(NOW - 500);
    const b = entry(NOW - 100);
    const before = [b, a];
    const copy = snapshot(before);
    expect(touchRemembered(before, a.id, NOW)).toEqual([{ ...a, t: NOW }, b]);
    expect(touchRemembered(before, hexId(), NOW)).toBeNull();
    expect(before).toEqual(copy);
  });
});

describe('remembered cap (remembered.cap_notice)', () => {
  it('TC-03 49 entries + new -> 50, dropped 0', () => {
    const before = entries(49);
    const result = upsertRemembered(before, entry(NOW));
    expect(before).toHaveLength(49);
    expect(result.entries).toHaveLength(50);
    expect(result.dropped).toBe(0);
  });

  it('TC-04 50 entries + new -> stays 50, oldest removed, dropped 1', () => {
    const before = entries(MAX_REMEMBERED_WORKSPACES);
    const copy = snapshot(before);
    const fresh = entry(NOW);
    const result = upsertRemembered(before, fresh);
    expect(before).toEqual(copy);
    expect(result.entries).toHaveLength(MAX_REMEMBERED_WORKSPACES);
    expect(result.entries[0]).toEqual(fresh);
    expect(result.entries.slice(1)).toEqual(before.slice(0, -1));
    expect(result.entries.some((e) => e.id === before.at(-1)!.id)).toBe(false);
    expect(result.dropped).toBe(1);
  });

  it('TC-05 50 entries + existing -> 50, order changed, dropped 0', () => {
    const before = entries(MAX_REMEMBERED_WORKSPACES);
    const moved = before[30]!;
    const result = upsertRemembered(before, { ...moved, t: NOW });
    expect(result.entries).toHaveLength(MAX_REMEMBERED_WORKSPACES);
    expect(result.entries[0]).toEqual({ ...moved, t: NOW });
    expect(result.entries.map((e) => e.id)).not.toEqual(before.map((e) => e.id));
    expect(new Set(result.entries.map((e) => e.id))).toEqual(new Set(before.map((e) => e.id)));
    expect(result.dropped).toBe(0);
  });
});

describe('forget (remembered.forget_api)', () => {
  it('TC-06 [A, B, C] remove B -> [A, C], order preserved', () => {
    const [a, b, c] = entries(3) as [RememberedEntry, RememberedEntry, RememberedEntry];
    const before = [a, b, c];
    const copy = snapshot(before);
    expect(removeRemembered(before, b.id)).toEqual({ entries: [a, c], changed: true });
    expect(before).toEqual(copy);
  });

  it('TC-07 [A] remove Z -> unchanged, changed = false', () => {
    const before = entries(1);
    const copy = snapshot(before);
    expect(removeRemembered(before, hexId())).toEqual({ entries: copy, changed: false });
    expect(before).toEqual(copy);
  });
});

describe('public projection (remembered.list_api)', () => {
  it('TC-08 has exactly id, name, lastOpenedAt, available and never the secret', () => {
    const e = entry(NOW);
    const row = { id: e.id, name: 'Kitchen 🍳 Ünïcode', secret_hash: 'f'.repeat(64) };
    const available = toPublic(e, row);
    expect(Object.keys(available).sort()).toEqual(['available', 'id', 'lastOpenedAt', 'name']);
    expect(available).toEqual({ id: e.id, name: row.name, lastOpenedAt: new Date(NOW * 1000).toISOString(), available: true });
    expect(RememberedPublic.parse(available)).toEqual(available);
    expect(JSON.stringify(available)).not.toContain(e.s);
    expect(JSON.stringify(available)).not.toContain(row.secret_hash);

    const unavailable = toPublic(e, undefined);
    expect(unavailable).toEqual({ id: e.id, name: null, lastOpenedAt: new Date(NOW * 1000).toISOString(), available: false });
    expect(JSON.stringify(unavailable)).not.toContain(e.s);
  });

  it('TC-08 the strict schema rejects any extra key', () => {
    const e = entry(NOW);
    expect(() => RememberedPublic.parse({ ...toPublic(e, undefined), s: e.s })).toThrow();
  });
});

describe('cookie attributes (remembered.cookie_attributes)', () => {
  const attrs = (header: string) =>
    header
      .split(';')
      .slice(1)
      .map((a) => a.trim());
  const base = ['HttpOnly', 'SameSite=Lax', 'Path=/api', `Max-Age=${REMEMBERED_COOKIE_MAX_AGE_S}`];

  it.each([
    ['local', base],
    ['staging', [...base, 'Secure']],
    ['production', [...base, 'Secure']],
  ])('TC-09 ENVIRONMENT=%s', (environment, expected) => {
    const header = rememberedCookieHeader('AQ', { ENVIRONMENT: environment });
    expect(header.startsWith('tdl_ws=AQ;')).toBe(true);
    expect(attrs(header)).toEqual(expected);
  });

  it.each(['local', 'staging', 'production'])('TC-10 the clear variant (%s): Max-Age=0, same name and Path', (environment) => {
    const header = clearRememberedCookieHeader({ ENVIRONMENT: environment });
    expect(header.startsWith('tdl_ws=;')).toBe(true);
    const list = attrs(header);
    expect(list).toContain('Max-Age=0');
    expect(list).toContain('Path=/api');
    expect(list).toContain('HttpOnly');
    expect(list).toContain('SameSite=Lax');
    expect(list.includes('Secure')).toBe(environment !== 'local');
  });
});
