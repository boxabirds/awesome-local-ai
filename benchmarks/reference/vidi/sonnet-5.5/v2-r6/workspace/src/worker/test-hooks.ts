import type { BoardRoom } from './board-room';

const HOOK_PATH = /^\/__test\/(corrupt-snapshot|repair)$/;
const SAVED_KEY = 'test_saved_chunk0';

const toBase64 = (b: Uint8Array): string => {
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s);
};
const fromBase64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Test-only storage corruption/repair, served by the room itself. Registered only when the
 * environment sets TEST_HOOKS=1 (e2e runs); production configuration never sets it.
 */
export async function handleTestHook(room: BoardRoom, req: Request): Promise<Response | null> {
  if (!room.testHooks || req.method !== 'POST') return null;
  const match = HOOK_PATH.exec(new URL(req.url).pathname);
  if (!match) return null;
  const sql = room.sql;
  if (match[1] === 'corrupt-snapshot') {
    if (room.doc) room.store.compactIfNeeded(room.doc, true);
    const row = sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray()[0];
    if (!row) return new Response('no snapshot', { status: 409 });
    sql.exec('INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)', SAVED_KEY, toBase64(new Uint8Array(row.data as ArrayBuffer)));
    sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', new Uint8Array([255, 255, 255, 255, 255]));
    room.loadFromStorage();
    return new Response('corrupted');
  }
  const saved = sql.exec('SELECT value FROM storage_meta WHERE key = ?', SAVED_KEY).toArray()[0];
  if (!saved) return new Response('nothing to repair', { status: 409 });
  sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', fromBase64(saved.value as string));
  sql.exec('DELETE FROM storage_meta WHERE key = ?', SAVED_KEY);
  return new Response('repaired');
}
