import { describe, expect, it } from 'vitest';
import { readShowCompleted, showCompletedKey, writeShowCompleted } from '@/features/tasks/showCompletedPref';

// Story 6, TC-U14: the remembered 'Show completed' choice. Storage is a plain-object stub: the
// persistence rules are under test, not the browser.

const WS_A = '0123456789ABCDEF0123456789ABCDEF';
const WS_B = 'FEDCBA9876543210FEDCBA9876543210';

function memoryStorage(): Storage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    get length() {
      return Object.keys(data).length;
    },
    clear: () => Object.keys(data).forEach((key) => delete data[key]),
    getItem: (key) => (key in data ? data[key]! : null),
    key: (index) => Object.keys(data)[index] ?? null,
    removeItem: (key) => void delete data[key],
    setItem: (key, value) => void (data[key] = String(value)),
  };
}

function throwingStorage(which: 'get' | 'set'): Storage {
  const storage = memoryStorage();
  const fail = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  if (which === 'get') storage.getItem = fail;
  else storage.setItem = fail;
  return storage;
}

describe('TC-U14 showCompleted preference codec', () => {
  it('absent key -> false', () => {
    expect(readShowCompleted(memoryStorage(), WS_A, 'inbox')).toBe(false);
  });

  it("stored '1' -> true, stored '0' -> false", () => {
    const storage = memoryStorage();
    storage.setItem(showCompletedKey(WS_A, 'inbox'), '1');
    expect(readShowCompleted(storage, WS_A, 'inbox')).toBe(true);
    storage.setItem(showCompletedKey(WS_A, 'inbox'), '0');
    expect(readShowCompleted(storage, WS_A, 'inbox')).toBe(false);
  });

  it('writes 1 and 0 under tdl:showCompleted:<workspace>:<list>', () => {
    const storage = memoryStorage();
    writeShowCompleted(storage, WS_A, 'inbox', true);
    expect(storage.data).toEqual({ [`tdl:showCompleted:${WS_A}:inbox`]: '1' });
    writeShowCompleted(storage, WS_A, 'inbox', false);
    expect(storage.data).toEqual({ [`tdl:showCompleted:${WS_A}:inbox`]: '0' });
  });

  it('getItem throws -> false, without throwing', () => {
    expect(() => readShowCompleted(throwingStorage('get'), WS_A, 'inbox')).not.toThrow();
    expect(readShowCompleted(throwingStorage('get'), WS_A, 'inbox')).toBe(false);
  });

  it('setItem throws -> the write is ignored, without throwing', () => {
    const storage = throwingStorage('set');
    expect(() => writeShowCompleted(storage, WS_A, 'inbox', true)).not.toThrow();
    expect(readShowCompleted(storage, WS_A, 'inbox')).toBe(false);
  });

  it('no storage at all -> false, and writes are ignored', () => {
    expect(readShowCompleted(undefined, WS_A, 'inbox')).toBe(false);
    expect(() => writeShowCompleted(undefined, WS_A, 'inbox', true)).not.toThrow();
  });

  it('keys are isolated per workspace and per list', () => {
    const storage = memoryStorage();
    writeShowCompleted(storage, WS_A, 'inbox', true);
    expect(readShowCompleted(storage, WS_B, 'inbox')).toBe(false);
    expect(readShowCompleted(storage, WS_A, 'project:groceries')).toBe(false);
    writeShowCompleted(storage, WS_B, 'inbox', false);
    expect(readShowCompleted(storage, WS_A, 'inbox')).toBe(true);
  });
});
