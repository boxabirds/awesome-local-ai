import { describe, expect, it } from 'vitest';
import { readShowCompleted, writeShowCompleted } from '@/features/tasks/showCompletedPref';

const WS_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01';
const WS_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb02';

/** A plain-object Storage: persistence semantics are under test, not the browser's. */
function memoryStorage(): Storage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    get length() {
      return Object.keys(data).length;
    },
    clear: () => Object.keys(data).forEach((k) => delete data[k]),
    getItem: (k) => (k in data ? data[k]! : null),
    key: (i) => Object.keys(data)[i] ?? null,
    removeItem: (k) => void delete data[k],
    setItem: (k, v) => void (data[k] = String(v)),
  };
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

describe('TC-U14 show-completed preference codec', () => {
  it('absent key reads false; stored 1 reads true; stored 0 reads false', () => {
    const storage = memoryStorage();
    expect(readShowCompleted(storage, WS_A, 'inbox')).toBe(false);
    writeShowCompleted(storage, WS_A, 'inbox', true);
    expect(storage.data[`tdl:showCompleted:${WS_A}:inbox`]).toBe('1');
    expect(readShowCompleted(storage, WS_A, 'inbox')).toBe(true);
    writeShowCompleted(storage, WS_A, 'inbox', false);
    expect(storage.data[`tdl:showCompleted:${WS_A}:inbox`]).toBe('0');
    expect(readShowCompleted(storage, WS_A, 'inbox')).toBe(false);
  });

  it('getItem throwing reads false; setItem throwing is ignored; no storage at all is fine', () => {
    expect(() => readShowCompleted(throwingStorage(), WS_A, 'inbox')).not.toThrow();
    expect(readShowCompleted(throwingStorage(), WS_A, 'inbox')).toBe(false);
    expect(() => writeShowCompleted(throwingStorage(), WS_A, 'inbox', true)).not.toThrow();
    expect(readShowCompleted(undefined, WS_A, 'inbox')).toBe(false);
    expect(() => writeShowCompleted(undefined, WS_A, 'inbox', true)).not.toThrow();
  });

  it('keys are isolated per workspace and per list', () => {
    const storage = memoryStorage();
    writeShowCompleted(storage, WS_A, 'inbox', true);
    expect(readShowCompleted(storage, WS_B, 'inbox')).toBe(false);
    expect(readShowCompleted(storage, WS_A, 'project:123')).toBe(false);
    writeShowCompleted(storage, WS_A, 'project:123', true);
    writeShowCompleted(storage, WS_A, 'inbox', false);
    expect(readShowCompleted(storage, WS_A, 'project:123')).toBe(true);
  });
});
