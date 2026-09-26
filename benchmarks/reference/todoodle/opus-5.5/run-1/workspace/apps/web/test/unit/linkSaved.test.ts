import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLinkSavedCache,
  hasSavedLink,
  isSnoozed,
  linkSavedKey,
  linkSnoozedKey,
  markLinkSaved,
  snooze,
  subscribe,
  useLinkReminderVisible,
} from '@/features/share/linkSaved';
import { countLocalReads, makeStorageUnavailable } from '../support/storage.ts';

const A = '0123456789ABCDEF0123456789ABCDEF';
const B = 'FEDCBA9876543210FEDCBA9876543210';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearLinkSavedCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TC-90 link-saved store', () => {
  it('uses versioned keys holding only the id, with value "1"', () => {
    expect(linkSavedKey(A)).toBe(`tdl:v1:linkSaved:${A}`);
    expect(linkSnoozedKey(A)).toBe(`tdl:v1:linkSnoozed:${A}`);
    markLinkSaved(A);
    snooze(B);
    expect(localStorage.getItem(`tdl:v1:linkSaved:${A}`)).toBe('1');
    expect(sessionStorage.getItem(`tdl:v1:linkSnoozed:${B}`)).toBe('1');
    expect(localStorage.length).toBe(1);
    expect(sessionStorage.length).toBe(1);
  });

  it('0 and 1 workspaces: flags are per workspace', () => {
    expect(hasSavedLink(A)).toBe(false);
    markLinkSaved(A);
    expect(hasSavedLink(A)).toBe(true);
    expect(hasSavedLink(B)).toBe(false);
    expect(isSnoozed(A)).toBe(false);
    snooze(A);
    expect(isSnoozed(A)).toBe(true);
    expect(isSnoozed(B)).toBe(false);
  });

  it('subscribe notifies on writes and unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    markLinkSaved(A);
    snooze(B);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    markLinkSaved(B);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('reads are cached, and a storage event invalidates the cache', () => {
    const reads = countLocalReads();
    try {
      expect(hasSavedLink(A)).toBe(false);
      expect(hasSavedLink(A)).toBe(false);
      expect(reads.count()).toBe(1);
    } finally {
      reads.restore();
    }

    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    // Another tab writes the flag: this tab's cache still says unsaved until the storage event.
    localStorage.setItem(linkSavedKey(A), '1');
    expect(hasSavedLink(A)).toBe(false);
    window.dispatchEvent(new StorageEvent('storage', { key: linkSavedKey(A), newValue: '1' }));
    expect(listener).toHaveBeenCalledOnce();
    expect(hasSavedLink(A)).toBe(true);
    unsubscribe();
  });

  it('storage exceptions are swallowed and reported as unsaved and not snoozed', () => {
    const restore = makeStorageUnavailable();
    try {
      expect(() => markLinkSaved(A)).not.toThrow();
      expect(() => snooze(A)).not.toThrow();
      expect(hasSavedLink(A)).toBe(false);
      expect(isSnoozed(A)).toBe(false);
    } finally {
      restore();
    }
  });

  it('useLinkReminderVisible: unsaved -> visible; snoozed or saved -> hidden', () => {
    const { result } = renderHook(() => useLinkReminderVisible(A));
    expect(result.current).toBe(true);
    act(() => snooze(A));
    expect(result.current).toBe(false);
    sessionStorage.clear();
    clearLinkSavedCache();
    const fresh = renderHook(() => useLinkReminderVisible(A));
    expect(fresh.result.current).toBe(true);
    act(() => markLinkSaved(A));
    expect(fresh.result.current).toBe(false);
  });
});
