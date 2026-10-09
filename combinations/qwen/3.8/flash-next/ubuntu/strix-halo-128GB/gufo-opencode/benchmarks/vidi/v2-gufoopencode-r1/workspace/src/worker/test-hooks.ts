import * as Y from 'yjs';
import type { BoardStore, BoardStorage } from './board-store';
import type { RoomPhase } from './room-state';

// Test-only room controls, reachable at POST /__test/boards/:boardId/<action>
// only when env.TEST_HOOKS === '1'. That variable is never set in production
// config; without it the route falls through to the static assets (SPA/404).
// The same gate exists inside the room, so a direct stub request is refused
// too.

export const TEST_HOOK_PREFIX = '/__test/boards/';

export function parseTestHookBoardId(pathname: string): string | null {
  if (!pathname.startsWith(TEST_HOOK_PREFIX)) return null;
  const rest = pathname.slice(TEST_HOOK_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  const trailing = rest.slice(slash + 1);
  if (trailing.includes('/')) return null;
  return rest.slice(0, slash);
}

export function isTestHookPath(pathname: string): { action: string } | null {
  if (!pathname.startsWith(TEST_HOOK_PREFIX)) return null;
  const segments = pathname.split('/');
  const action = segments[segments.length - 1];
  return action.length > 0 ? { action } : null;
}

export interface RoomTestHookAccess {
  readonly testStore: BoardStore;
  readonly testStorage: BoardStorage;
  readonly testPhase: RoomPhase;
  readonly testLoadAttempts: number;
  armFailAppendOnce(): void;
  seedNotes(count: number): void;
  seedLegacy(updatesBase64: string[]): void;
  initializeBoard(): 'created' | 'exists';
}

const BACKUP_KEY = 'test_chunk0_backup';

export async function runRoomTestHook(
  action: string,
  room: RoomTestHookAccess,
  params: URLSearchParams,
  request: Request
): Promise<Response> {
  const sql = room.testStorage.sql;
  switch (action) {
    case 'state':
      return Response.json({ phase: room.testPhase, loadAttempts: room.testLoadAttempts });
    case 'tables': {
      const rows = sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .toArray();
      return Response.json({ tables: rows.map((row) => String(row['name'])) });
    }
    case 'meta': {
      if (!room.testStore.tableExists('storage_meta')) return Response.json({ meta: null });
      const rows = sql.exec('SELECT key, value FROM storage_meta').toArray();
      const meta: Record<string, string> = {};
      for (const row of rows) {
        const raw = row['value'];
        meta[String(row['key'])] =
          typeof raw === 'string' ? raw : new TextDecoder().decode(raw as Uint8Array);
      }
      return Response.json({ meta });
    }
    case 'initialize':
      return Response.json({ result: room.initializeBoard() });
    case 'seed-legacy': {
      // Story 5 TC-31 / TC-08: a board that already has `updates` rows but no
      // created_at marker — exactly the shape of storage written before the
      // sharing feature shipped. The room reloads so connecting clients see
      // the seeded content.
      let body: { updates?: unknown };
      try {
        body = (await request.json()) as { updates?: unknown };
      } catch {
        return Response.json({ ok: false, reason: 'expected JSON body' }, { status: 400 });
      }
      const updates = body.updates;
      if (!Array.isArray(updates) || updates.length === 0 || updates.some((u) => typeof u !== 'string')) {
        return Response.json({ ok: false, reason: 'updates must be a non-empty base64 string array' }, { status: 400 });
      }
      room.seedLegacy(updates as string[]);
      return Response.json({ ok: true, rows: updates.length });
    }
    case 'stats':
      return Response.json(room.testStore.stats());
    case 'compact': {
      const doc = new Y.Doc();
      const loaded = room.testStore.load(doc);
      if (!loaded.ok) return Response.json({ done: false, reason: loaded.reason });
      return Response.json({ done: room.testStore.compact(doc) });
    }
    case 'corrupt-snapshot': {
      const exists = sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray();
      if (exists.length === 0) return Response.json({ ok: false, reason: 'no-snapshot' }, { status: 400 });
      sql.exec(
        "INSERT OR REPLACE INTO storage_meta (key, value) SELECT ?, data FROM snapshot_chunks WHERE idx = 0",
        BACKUP_KEY
      );
      // Poison with a varint claiming ~2^30 records: decoding cannot ever
      // succeed, so the snapshot is reliably unreadable (random bytes could
      // decode as a valid empty update).
      sql.exec("UPDATE snapshot_chunks SET data = X'ffffffff3f' || substr(data, 6) WHERE idx = 0");
      return Response.json({ ok: true });
    }
    case 'repair-snapshot': {
      const backup = sql.exec('SELECT value FROM storage_meta WHERE key = ?', BACKUP_KEY).toArray();
      if (backup.length === 0) return Response.json({ ok: false, reason: 'no-backup' }, { status: 400 });
      sql.exec(
        'UPDATE snapshot_chunks SET data = (SELECT value FROM storage_meta WHERE key = ?) WHERE idx = 0',
        BACKUP_KEY
      );
      sql.exec('DELETE FROM storage_meta WHERE key = ?', BACKUP_KEY);
      return Response.json({ ok: true });
    }
    case 'seed': {
      const count = Number(params.get('count') ?? '0');
      if (!Number.isInteger(count) || count < 1 || count > 5000) {
        return Response.json({ ok: false, reason: 'count must be 1..5000' }, { status: 400 });
      }
      room.seedNotes(count);
      return Response.json({ ok: true, seeded: count });
    }
    case 'fail-append':
      room.armFailAppendOnce();
      return Response.json({ ok: true });
    case 'fail-load':
      // Persistent poison: the load-time SELECT fails on every wake until
      // clear-fail-load restores the column. An in-memory flag would be lost
      // with the evicted instance the test is about to restart.
      try {
        sql.exec('ALTER TABLE updates RENAME COLUMN data TO data_poisoned');
      } catch (error) {
        return Response.json({ ok: false, reason: String(error) }, { status: 400 });
      }
      return Response.json({ ok: true });
    case 'clear-fail-load':
      try {
        sql.exec('ALTER TABLE updates RENAME COLUMN data_poisoned TO data');
      } catch (error) {
        return Response.json({ ok: false, reason: String(error) }, { status: 400 });
      }
      return Response.json({ ok: true });
    default:
      return new Response('unknown test action', { status: 404 });
  }
}
