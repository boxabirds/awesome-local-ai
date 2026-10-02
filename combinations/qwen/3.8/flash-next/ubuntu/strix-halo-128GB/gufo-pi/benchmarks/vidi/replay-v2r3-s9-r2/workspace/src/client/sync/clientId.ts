/**
 * Per-browser identity (story 9, minimal).
 *
 * Story 6 ("see who else is on the board") owns the real identity, including a
 * name and colour, and is not part of this build. Text objects still record who
 * created them, so this provides the stable id half of that: a random id kept
 * for the lifetime of the browser tab, which is also what Yjs uses as the
 * client identity for changes made here.
 */
let cached: string | null = null;

export function getClientId(): string {
  if (cached !== null) return cached;
  let id: string | null = null;
  try {
    const store = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    id = store?.getItem('vidi6:client-id') ?? null;
    if (!id) {
      id = crypto.randomUUID();
      store?.setItem('vidi6:client-id', id);
    }
  } catch {
    id = id ?? fallbackId();
  }
  cached = id;
  return cached;
}

function fallbackId(): string {
  // Environments without crypto.randomUUID (older browsers, restricted jsdom).
  let out = '';
  for (let i = 0; i < 32; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}
