const KEY = 'vidi6.guestId';
let memory: string | null = null;

/** Stable per-browser guest id used as `createdBy` (sign-in and profiles are not part of this build). */
export function localIdentityId(): string {
  if (memory) return memory;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return (memory = stored);
  } catch { /* storage unavailable: fall through to a per-page id */ }
  memory = `g_${crypto.randomUUID().slice(0, 8)}`;
  try { localStorage.setItem(KEY, memory); } catch { /* ignore */ }
  return memory;
}
