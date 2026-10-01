const KEY = 'vidi6.identity';

/** A stable per-browser id for `createdBy` until sign-in exists (story 6 is not part of this build). */
export function localIdentityId(): string {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored) return stored;
    const id = `g_${crypto.randomUUID()}`;
    window.localStorage.setItem(KEY, id);
    return id;
  } catch {
    return 'g_local';
  }
}
