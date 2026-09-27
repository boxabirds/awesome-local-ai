import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasSavedLink,
  isSnoozed,
  linkSavedKey,
  linkSnoozedKey,
  markLinkSaved,
  resetLinkSavedCacheForTests,
  snooze,
  subscribe,
} from '@/features/share/linkSaved';
import { SECRET } from '../fixtures';

const A = '0123456789abcdef0123456789abcdef';
const B = 'fedcba9876543210fedcba9876543210';

function throwingStorage() {
  for (const area of ['localStorage', 'sessionStorage'] as const) {
    vi.spyOn(window, area, 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
  }
}

afterEach(() => resetLinkSavedCacheForTests());

describe('linkSaved store', () => {
  it('TC-90 key format uses only the workspace id', () => {
    expect(linkSavedKey(A)).toBe(`tdl:v1:linkSaved:${A}`);
    expect(linkSnoozedKey(A)).toBe(`tdl:v1:linkSnoozed:${A}`);
  });

  it('TC-90 with no workspaces saved nothing is marked', () => {
    expect(window.localStorage.length).toBe(0);
    expect(hasSavedLink(A)).toBe(false);
    expect(isSnoozed(A)).toBe(false);
  });

  it("TC-90 markLinkSaved stores '1' under the id key for that workspace only", () => {
    markLinkSaved(A);
    expect(window.localStorage.getItem(`tdl:v1:linkSaved:${A}`)).toBe('1');
    expect(hasSavedLink(A)).toBe(true);
    expect(hasSavedLink(B)).toBe(false);
    expect(window.localStorage.length).toBe(1);
  });

  it("TC-90 snooze stores '1' in sessionStorage, not localStorage", () => {
    snooze(A);
    expect(window.sessionStorage.getItem(`tdl:v1:linkSnoozed:${A}`)).toBe('1');
    expect(window.localStorage.length).toBe(0);
    expect(isSnoozed(A)).toBe(true);
    expect(hasSavedLink(A)).toBe(false);
  });

  it('TC-90 subscribers are notified on mark and snooze, and can unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    markLinkSaved(A);
    snooze(B);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    markLinkSaved(B);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('TC-90 storage exceptions are swallowed and read as unsaved, unsnoozed', () => {
    throwingStorage();
    expect(() => markLinkSaved(A)).not.toThrow();
    expect(() => snooze(A)).not.toThrow();
    expect(hasSavedLink(A)).toBe(false);
    expect(isSnoozed(A)).toBe(false);
  });

  it('TC-90 getItem/setItem throwing is also swallowed', () => {
    const failing = {
      getItem: vi.fn(() => {
        throw new Error('quota');
      }),
      setItem: vi.fn(() => {
        throw new Error('quota');
      }),
    };
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(failing as unknown as Storage);
    expect(() => markLinkSaved(A)).not.toThrow();
    expect(hasSavedLink(A)).toBe(false);
    expect(failing.setItem).toHaveBeenCalled();
  });

  it('TC-90 reads are cached and the cache is invalidated by a storage event', () => {
    const real = window.localStorage;
    const getItem = vi.fn((key: string) => real.getItem(key));
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue({ getItem } as unknown as Storage);
    const unsubscribe = subscribe(() => {});
    expect(hasSavedLink(A)).toBe(false);
    expect(hasSavedLink(A)).toBe(false);
    expect(getItem).toHaveBeenCalledTimes(1);

    // Another tab saves the link.
    real.setItem(linkSavedKey(A), '1');
    expect(hasSavedLink(A)).toBe(false); // still cached
    window.dispatchEvent(new StorageEvent('storage', { key: linkSavedKey(A), newValue: '1' }));
    expect(hasSavedLink(A)).toBe(true);
    expect(getItem).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('TC-90 no stored value ever contains a secret', () => {
    markLinkSaved(A);
    snooze(A);
    const values = [
      ...Object.entries(window.localStorage),
      ...Object.entries(window.sessionStorage),
    ].flat();
    expect(values.join()).not.toContain(SECRET);
    expect(values.filter((v) => !v.startsWith('tdl:v1:'))).toEqual(['1', '1']);
  });
});
