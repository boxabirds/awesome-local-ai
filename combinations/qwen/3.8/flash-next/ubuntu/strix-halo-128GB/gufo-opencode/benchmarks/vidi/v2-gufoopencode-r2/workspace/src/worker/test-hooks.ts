// Story 4 test hooks (never enabled in production):
//
//   POST /__test/boards/:id/corrupt-snapshot  → force a compaction, back up
//        chunk 0 in DO KV storage, then overwrite it with garbage.
//   POST /__test/boards/:id/repair            → restore the backup.
//
// Routes are registered only when env.TEST_HOOKS === '1' (set by the e2e
// `wrangler dev --var TEST_HOOKS:1` only). Without it the paths fall through
// to the static-asset SPA handler, so a production build has no hooks.

import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

const TEST_HOOK_ROUTE =
  /^\/__test\/boards\/([^/?]+)\/(corrupt-snapshot|repair-snapshot|repair)$/;

export async function maybeHandleTestHook(req: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const hook = TEST_HOOK_ROUTE.exec(pathname);
  if (hook === null || env.TEST_HOOKS !== '1') return null;
  const boardId = decodeURIComponent(hook[1]);
  if (!isValidBoardId(boardId)) {
    return new Response('Invalid board id', { status: 400 });
  }
  const inner = hook[2] === 'repair' ? 'repair-snapshot' : hook[2];
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return stub.fetch(
    new Request(`https://board/__test/${inner}`, { method: req.method, headers: req.headers }),
  );
}
