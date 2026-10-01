const KEY = 'vidi6.userId';

let cached: string | null = null;

/** A stable per-browser id recorded as createdBy on new objects (sign-in, story 6, is not part of this build). */
export function getLocalUserId(): string {
  if (cached) return cached;
  try {
    cached = localStorage.getItem(KEY);
    if (!cached) {
      cached = `u_${crypto.randomUUID()}`;
      localStorage.setItem(KEY, cached);
    }
  } catch {
    cached ??= `u_${crypto.randomUUID()}`;
  }
  return cached;
}
