import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

const SAVED_KEY = 'test_saved_chunk0';
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

/** Saves the original chunk 0 (once) and overwrites it with a truncated copy that cannot be decoded. */
export function corruptSnapshot(storage: DurableObjectStorage): string {
  const rows = storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray();
  if (rows.length === 0) return 'no snapshot';
  const original = new Uint8Array(rows[0].data as ArrayBuffer);
  storage.sql.exec('INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)', SAVED_KEY, hex(original));
  storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original.slice(0, Math.max(1, original.length - 10)));
  return 'corrupted';
}

export function repairSnapshot(storage: DurableObjectStorage): string {
  const rows = storage.sql.exec('SELECT value FROM storage_meta WHERE key = ?', SAVED_KEY).toArray();
  if (rows.length === 0) return 'nothing to repair';
  storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', unhex(String(rows[0].value)));
  storage.sql.exec('DELETE FROM storage_meta WHERE key = ?', SAVED_KEY);
  return 'repaired';
}

const ROUTE = /^\/__test\/boards\/([^/]+)\/(corrupt-snapshot|repair)$/;

/** Handles the test-only routes; returns null for anything else. Registered only when env.TEST_HOOKS === '1'. */
export async function handleTestHook(req: Request, env: Env): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1' || req.method !== 'POST') return null;
  const match = ROUTE.exec(new URL(req.url).pathname);
  if (!match || !isValidBoardId(match[1])) return null;
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(match[1]));
  return new Response(await stub.testHook(match[2] as 'corrupt-snapshot' | 'repair'));
}
