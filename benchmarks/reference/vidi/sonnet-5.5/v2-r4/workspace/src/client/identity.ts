const KEY = 'vidi6.identity';
let fallback: string | null = null;

/** Stable anonymous id of this browser, stored as `createdBy` on new objects (sign-in is a later story). */
export function localIdentityId(): string {
  try {
    const stored = globalThis.localStorage?.getItem(KEY);
    if (stored) return stored;
    const id = `g_${crypto.randomUUID()}`;
    globalThis.localStorage?.setItem(KEY, id);
    return id;
  } catch {
    return (fallback ??= `g_${crypto.randomUUID()}`);
  }
}
