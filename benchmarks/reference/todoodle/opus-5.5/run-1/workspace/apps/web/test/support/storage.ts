type Area = 'localStorage' | 'sessionStorage';

function override(area: Area, get: () => Storage): () => void {
  const own = Object.getOwnPropertyDescriptor(window, area);
  Object.defineProperty(window, area, { configurable: true, get });
  return () => {
    if (own) Object.defineProperty(window, area, own);
    else delete (window as unknown as Record<string, unknown>)[area];
  };
}

/** localStorage and sessionStorage throw on access (private mode, blocked site data). Returns a restore function. */
export function makeStorageUnavailable(): () => void {
  const fail = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  const restoreLocal = override('localStorage', fail);
  const restoreSession = override('sessionStorage', fail);
  return () => {
    restoreLocal();
    restoreSession();
  };
}

/** Counts localStorage.getItem calls while delegating to the real storage. */
export function countLocalReads(): { count: () => number; restore: () => void } {
  const real = window.localStorage;
  let reads = 0;
  const counting = {
    getItem: (key: string) => {
      reads++;
      return real.getItem(key);
    },
    setItem: (key: string, value: string) => real.setItem(key, value),
  } as Storage;
  return { count: () => reads, restore: override('localStorage', () => counting) };
}
