import { RememberedListResponse, type RememberedPublic } from '@todoodle/shared/schemas';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { pickContinueTarget } from '@/features/remembered/pickContinueTarget';
import { relativeTime } from '@/features/remembered/relativeTime';
import { rememberedPlaceholder } from '@/features/remembered/rememberedPlaceholder';
import { queryKeys } from '@/lib/queryKeys';

const NOW = Date.parse('2026-09-27T12:00:00.000Z');
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const X = 'cccccccccccccccccccccccccccccccc';
const Y = 'dddddddddddddddddddddddddddddddd';

function available(id: string, name: string): RememberedPublic {
  return { id, name, lastOpenedAt: ago(60), available: true };
}
function unavailable(id: string): RememberedPublic {
  return { id, name: null, lastOpenedAt: ago(60), available: false };
}

describe('relativeTime (TC-11)', () => {
  it.each([
    [30, 'just now'],
    [59, 'just now'],
    [60, '1 minute ago'],
    [86_400, 'yesterday'],
    [400 * 86_400, 'over a year ago'],
  ])('%is ago -> %s', (seconds, expected) => {
    expect(relativeTime(ago(seconds), NOW)).toBe(expected);
  });

  it('a few more steps between the boundaries', () => {
    expect(relativeTime(ago(5 * 60), NOW)).toBe('5 minutes ago');
    expect(relativeTime(ago(3 * 3600), NOW)).toBe('3 hours ago');
    expect(relativeTime(ago(3 * 86_400), NOW)).toBe('3 days ago');
    expect(relativeTime(ago(90 * 86_400), NOW)).toBe('3 months ago');
  });
});

describe('pickContinueTarget (TC-12)', () => {
  it('empty -> null', () => {
    expect(pickContinueTarget([])).toBeNull();
  });

  it('[A] -> A', () => {
    expect(pickContinueTarget([available(A, 'Home 🏡')])).toEqual({ id: A, name: 'Home 🏡' });
  });

  it('[unavailable X, A, B] -> A (first available, not index 0)', () => {
    const list = [unavailable(X), available(A, 'A'), available(B, 'B')];
    const before = structuredClone(list);
    expect(pickContinueTarget(list)).toEqual({ id: A, name: 'A' });
    expect(list).toEqual(before);
  });

  it('[unavailable X, unavailable Y] -> null', () => {
    expect(pickContinueTarget([unavailable(X), unavailable(Y)])).toBeNull();
  });
});

describe('rememberedPlaceholder (TC-13)', () => {
  function clientWith(list?: RememberedPublic[]) {
    const client = new QueryClient();
    if (list) client.setQueryData(queryKeys.remembered(), RememberedListResponse.parse({ workspaces: list }).workspaces);
    return client;
  }

  it('reads only the cache: A -> {id, name}; unavailable B, unknown Z -> undefined; cache unchanged', () => {
    const client = clientWith([available(A, 'Groceries'), unavailable(B)]);
    const before = structuredClone(client.getQueryData(queryKeys.remembered()));
    const fetchSpy = vi.spyOn(client, 'fetchQuery');
    const setSpy = vi.spyOn(client, 'setQueryData');

    expect(rememberedPlaceholder(client, A)).toEqual({ id: A, name: 'Groceries' });
    expect(rememberedPlaceholder(client, B)).toBeUndefined();
    expect(rememberedPlaceholder(client, X)).toBeUndefined();

    expect(client.getQueryData(queryKeys.remembered())).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(client.getQueryCache().findAll()).toHaveLength(1);
  });

  it('empty cache -> undefined, and nothing is added to the cache', () => {
    const client = clientWith();
    expect(rememberedPlaceholder(client, A)).toBeUndefined();
    expect(client.getQueryCache().findAll()).toHaveLength(0);
  });

  it('follows a new list (the index is rebuilt per list)', () => {
    const client = clientWith([available(A, 'Old name')]);
    expect(rememberedPlaceholder(client, A)?.name).toBe('Old name');
    client.setQueryData(queryKeys.remembered(), [available(A, 'New name')]);
    expect(rememberedPlaceholder(client, A)?.name).toBe('New name');
  });
});
