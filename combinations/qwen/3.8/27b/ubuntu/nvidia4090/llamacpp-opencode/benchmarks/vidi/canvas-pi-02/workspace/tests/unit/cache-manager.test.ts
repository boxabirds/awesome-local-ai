/**
 * TC-03: localDbName and format version check.
 * TC-04: chooseEvictions with MAX+1 entries → evicts oldest synced.
 * TC-05: oldest unsynced → evicts oldest synced instead.
 * TC-06: all over-limit unsynced → evicts nothing.
 * TC-07: open board is least recent → never chosen.
 */
import { describe, it, expect } from 'vitest';
import { localDbName, isUsableCopy } from '../../src/client/offline/localBoardStore';
import { chooseEvictions, choosePressureEvictions } from '../../src/client/offline/cacheManager';
import { LOCAL_BOARD_CACHE_MAX_BOARDS, LOCAL_COPY_FORMAT_VERSION } from '../../src/shared/config';
import type { CacheEntry } from '../../src/client/offline/cacheManager';

describe('TC-03: localDbName and format version', () => {
  it('localDbName returns prefix + id', () => {
    expect(localDbName('abc')).toBe('vidi6-board-abc');
  });

  it('isUsableCopy returns true for matching version', () => {
    expect(isUsableCopy(LOCAL_COPY_FORMAT_VERSION)).toBe(true);
  });

  it('isUsableCopy returns false for mismatch', () => {
    expect(isUsableCopy(999)).toBe(false);
  });

  it('isUsableCopy returns false for null/undefined', () => {
    expect(isUsableCopy(null)).toBe(false);
    expect(isUsableCopy(undefined)).toBe(false);
  });
});

function makeEntry(boardId: string, lastOpenedAt: number, unsynced = false): CacheEntry {
  return { boardId, lastOpenedAt, unsynced, formatVersion: 1 };
}

describe('TC-04: chooseEvictions boundary', () => {
  it('evicts exactly the least recently opened synced entry', () => {
    const max = 3;
    // 4 entries, oldest is 'a' (synced).
    const entries = [
      makeEntry('a', 100),
      makeEntry('b', 200),
      makeEntry('c', 300),
      makeEntry('d', 400),
    ];
    expect(chooseEvictions(entries, 'd', max)).toEqual(['a']);
  });
});

describe('TC-05: chooseEvictions skips unsynced', () => {
  it('oldest unsynced is kept; evicts oldest synced instead', () => {
    const max = 3;
    const entries = [
      makeEntry('a', 100, true),  // unsynced, oldest
      makeEntry('b', 200),        // synced
      makeEntry('c', 300),
      makeEntry('d', 400),
    ];
    expect(chooseEvictions(entries, 'd', max)).toEqual(['b']);
  });
});

describe('TC-06: chooseEvictions all unsynced over limit', () => {
  it('evicts nothing when all candidates are unsynced', () => {
    const max = 2;
    const entries = [
      makeEntry('a', 100, true),
      makeEntry('b', 200, true),
      makeEntry('c', 300, true),
    ];
    expect(chooseEvictions(entries, 'c', max)).toEqual([]);
  });
});

describe('TC-07: open board is never evicted', () => {
  it('open board as least recent is never chosen by chooseEvictions', () => {
    const max = 2;
    const entries = [
      makeEntry('open', 100),  // open board, oldest
      makeEntry('b', 200),
      makeEntry('c', 300),
    ];
    expect(chooseEvictions(entries, 'open', max)).toEqual(['b']);
  });

  it('open board as least recent is never chosen by choosePressureEvictions', () => {
    const entries = [
      makeEntry('open', 100),
      makeEntry('b', 200),
      makeEntry('c', 300),
    ];
    expect(choosePressureEvictions(entries, 'open')).toEqual(['b', 'c']);
  });
});
