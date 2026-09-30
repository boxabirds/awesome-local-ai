/**
 * Test-only HTTP hooks, registered ONLY when `env.TEST_HOOKS === '1'`.
 * Used by the integration (forks pool) and e2e tests to inspect storage and
 * inject load/storage failures. This environment variable is never set in
 * production config; the e2e/production build is verified to lack these routes.
 * Story 4: persistence.
 */
import type { Env } from './index';
import type { BoardRoom } from './board-room';
import { isValidBoardId } from '../shared/board-id';

const PREFIX = '/__test/boards/';

/**
 * Returns a Response if `url.pathname` is a test hook, otherwise null (the
 * caller continues normal routing). Never wired when TEST_HOOKS !== '1'.
 */
export async function routeTestHook(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX)) return null;

  const rest = url.pathname.slice(PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return new Response('Bad test path', { status: 400 });
  const boardId = rest.slice(0, slash);
  const op = rest.slice(slash + 1);

  if (!isValidBoardId(boardId)) return new Response('Bad board id', { status: 400 });

  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const room = stub as unknown as BoardRoom;

  switch (op) {
    case 'rows': {
      const updates = await (room as any)._testUpdatesRowCount();
      const snapshotChunks = await (room as any)._testSnapshotChunkCount();
      const roomState = await (room as any)._testRoomState();
      const freshDocNoteCount = await (room as any)._testFreshDocNoteCount();
      return json({ updates, snapshotChunks, roomState, freshDocNoteCount });
    }
    case 'corrupt-snapshot': {
      const ok = await (room as any)._testCorruptSnapshot();
      return json({ ok });
    }
    case 'repair-snapshot': {
      const ok = await (room as any)._testRepairSnapshot();
      return json({ ok });
    }
    case 'force-compact': {
      const ok = await (room as any)._testForceCompact();
      return json({ ok });
    }
    case 'seed': {
      const count = parseInt(url.searchParams.get('count') ?? '0', 10);
      const seeded = await (room as any)._testSeedNotes(Number.isFinite(count) ? count : 0);
      return json({ seeded });
    }
    case 'seed-legacy': {
      // Seed updates rows without created_at (simulates pre-story-5 board)
      const count = parseInt(url.searchParams.get('count') ?? '3', 10);
      const seeded = await (room as any)._testSeedLegacyNotes(Number.isFinite(count) ? count : 3);
      return json({ seeded });
    }
    case 'fail-next-append': {
      const n = parseInt(url.searchParams.get('n') ?? '1', 10);
      await (room as any)._testFailNextAppends(Number.isFinite(n) ? n : 1);
      return json({ ok: true });
    }
    case 'fail-next-load': {
      await (room as any)._testFailNextLoad();
      return json({ ok: true });
    }
    case 'reload': {
      await (room as any)._testReload();
      const roomState = await (room as any)._testRoomState();
      return json({ roomState });
    }
    case 'enter-load-failed': {
      await (room as any)._testEnterLoadFailedNow();
      return json({ ok: true });
    }
    case 'set-load-failed-past': {
      await (room as any)._testSetLoadFailedAt(0);
      return json({ ok: true });
    }
    default:
      return new Response('Unknown test op', { status: 404 });
  }
}

function json(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    headers: { 'content-type': 'application/json' },
  });
}
