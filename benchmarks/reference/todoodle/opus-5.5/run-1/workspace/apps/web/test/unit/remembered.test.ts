import { QueryClient } from '@tanstack/react-query';
import { type RememberedPublic, RememberedPublic as RememberedSchema } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { pickContinueTarget } from '@/features/remembered/pickContinueTarget';
import { relativeTime } from '@/features/remembered/relativeTime';
import { rememberedPlaceholder } from '@/features/remembered/rememberedPlaceholder';
import { queryKeys } from '@/lib/queryKeys';

const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;
const NOW = Date.parse('2026-09-26T12:00:00.000Z');

function entry(id: string, name: string | null, available = name !== null): RememberedPublic {
  return RememberedSchema.parse({ id, name, lastOpenedAt: new Date(NOW - DAY).toISOString(), available });
}

const A = entry('A'.repeat(32), 'Home 🏠');
const B = entry('B'.repeat(32), 'Work');
const X = entry('C'.repeat(32), null);
const Y = entry('D'.repeat(32), null);

describe('home.remembered_list', () => {
  it.each([
    [30 * SECOND, 'just now'],
    [59 * SECOND, 'just now'],
    [60 * SECOND, '1 minute ago'],
    [DAY, 'yesterday'],
    [400 * DAY, 'over a year ago'],
  ])('TC-11 %i ms ago -> %s', (ago, expected) => {
    expect(relativeTime(new Date(NOW - ago).toISOString(), NOW)).toBe(expected);
  });
});

describe('home.continue_recent', () => {
  it('TC-12 first available entry, never an unavailable one', () => {
    expect(pickContinueTarget([])).toBeNull();
    expect(pickContinueTarget([A])).toEqual({ id: A.id, name: A.name });
    expect(pickContinueTarget([X, A, B])).toEqual({ id: A.id, name: A.name });
    expect(pickContinueTarget([X, Y])).toBeNull();
  });
});

describe('workspace.instant_name', () => {
  it('TC-13 reads the cached list only: available -> {id, name}; unavailable / absent / empty cache -> undefined', () => {
    const queryClient = new QueryClient();
    expect(rememberedPlaceholder(queryClient, A.id)).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);

    const unavailableB = { ...B, name: null, available: false };
    const list = [A, unavailableB];
    queryClient.setQueryData(queryKeys.remembered(), list);
    const snapshot = structuredClone(list);

    expect(rememberedPlaceholder(queryClient, A.id)).toEqual({ id: A.id, name: A.name });
    expect(rememberedPlaceholder(queryClient, B.id)).toBeUndefined();
    expect(rememberedPlaceholder(queryClient, 'Z'.repeat(32))).toBeUndefined();

    expect(queryClient.getQueryData(queryKeys.remembered())).toBe(list);
    expect(list).toEqual(snapshot);
    expect(queryClient.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([queryKeys.remembered()]);
  });
});
