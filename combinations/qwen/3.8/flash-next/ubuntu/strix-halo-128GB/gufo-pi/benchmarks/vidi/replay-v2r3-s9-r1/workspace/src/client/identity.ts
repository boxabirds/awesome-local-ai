/**
 * A local identity for this browser (story 9 stores it as an object's
 * `createdBy`). Story 6 replaces this with the real identity and presence
 * layer; until then it is a random id kept in localStorage so objects created
 * by the same person keep a stable attribution across boards and reloads.
 */
const STORAGE_KEY = 'vidi6:client-id';

let cached: string | null = null;

function randomId(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  return `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/** This client's id, created on first use. Never throws without storage. */
export function getClientId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
    const id = randomId();
    localStorage.setItem(STORAGE_KEY, id);
    cached = id;
    return id;
  } catch {
    // Private mode or no storage: an id that lives as long as the page.
    cached = randomId();
    return cached;
  }
}
