// Story 4, task 9: test-only worker routes for the persistence e2e
// (persist.client_status TC-24 and the TC-19..TC-21 seed/compact flow).
//
// Registered ONLY when env.TEST_HOOKS === '1', which is set exclusively on
// the e2e dev server (`wrangler dev --var TEST_HOOKS=1`); the production
// config never sets it, so these routes are unreachable there.
//
//   POST /__test/boards/:boardId/compact           force compaction of the
//                                                  live room doc (the e2e
//                                                  boards stay below the
//                                                  natural thresholds)
//   POST /__test/boards/:boardId/corrupt-snapshot  corrupt snapshot chunk 0
//                                                  (original backed up)
//   POST /__test/boards/:boardId/repair            restore snapshot chunk 0
//   POST /__test/boards/:boardId/wake              simulate a hibernation
//                                                  wake: re-run the load
//                                                  (wrangler dev may keep
//                                                  the object alive instead
//                                                  of hibernating it; a wake
//                                                  reconstructs + loads)
//   POST /__test/boards/:boardId/seed              seed `count` stickies
//                                                  directly into the room doc
//   POST /__test/boards/:boardId/notes             return the room's durable
//                                                  note count (server truth)
//   POST /__test/boards/:boardId/initialize        create the board's storage
//                                                  (story 5 share.board_api):
//                                                  returns 'created' | 'exists'
//   POST /__test/boards/:boardId/seed-legacy       write LEGACY storage
//                                                  (updates table only, no
//                                                  created_at) for the
//                                                  legacy-board e2e (TC-31)
//   POST /__test/boards/:boardId/seed-flow         seed the story 10
//                                                  checkout-flow fixture
//                                                  (labelled shapes +
//                                                  connectors) via the real
//                                                  model calls; body: the
//                                                  flow spec, returns the id
//                                                  map
//   POST /__test/boards/:boardId/flow              per-type object counts of
//                                                  the room doc (server
//                                                  ground truth)

import { isValidBoardId } from '../shared/board-id';
import type { Env, FlowSpec } from './board-room';

const HOOK_PATH = /^\/__test\/boards\/([^/]+)\/(compact|corrupt-snapshot|repair|wake|seed|notes|initialize|seed-legacy|seed-flow|flow)$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Handle a /__test/ request, or return null when it is not one. */
export async function handleTestHooks(req: Request, env: Env): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1') {
    return null;
  }
  const url = new URL(req.url);
  if (req.method !== 'POST') {
    return null;
  }
  const match = HOOK_PATH.exec(url.pathname);
  if (match === null) {
    return null;
  }
  const [, boardId, action] = match;
  if (boardId === undefined || action === undefined || !isValidBoardId(boardId)) {
    return json({ ok: false, reason: 'invalid-board-id' }, 400);
  }
  const id = env.BOARD_ROOM.idFromName(boardId);
  const room = env.BOARD_ROOM.get(id);
  switch (action) {
    case 'seed': {
      const body = (await req.json().catch(() => null)) as { count?: number } | null;
      const count = typeof body?.count === 'number' ? body.count : 0;
      const seeded = await room.testSeedNotes(count);
      return json({ ok: seeded > 0, seeded }, seeded > 0 ? 200 : 409);
    }
    case 'compact':
      return room
        .testForceCompact()
        .then((ok) => json({ ok }, ok ? 200 : 409));
    case 'corrupt-snapshot':
      return room
        .testCorruptSnapshotChunk0()
        .then((result) => json(result, result.ok ? 200 : 409));
    case 'repair':
      return room
        .testRepairSnapshotChunk0()
        .then((result) => json(result, result.ok ? 200 : 409));
    case 'wake':
      return room.testReload().then((result) => json({ ok: true, ...result }));
    case 'notes':
      return room
        .testNoteCount()
        .then((notes) => json({ ok: true, notes }));
    case 'initialize':
      return room.initialize().then((state) => json({ ok: true, state }));
    case 'seed-legacy': {
      const body = (await req.json().catch(() => null)) as { count?: number } | null;
      const count = typeof body?.count === 'number' ? body.count : 0;
      const seeded = await room.testSeedLegacyNotes(count);
      return json({ ok: seeded > 0, count: seeded }, seeded > 0 ? 200 : 409);
    }
    case 'seed-flow': {
      const body = (await req.json().catch(() => null)) as FlowSpec | null;
      const seeded = await room.testSeedFlow(body ?? { shapes: [], connectors: [] });
      const ok = Object.keys(seeded.shapes).length > 0 || seeded.connectors.length > 0;
      return json({ ok, ...seeded }, ok ? 200 : 409);
    }
    case 'flow':
      return room.testFlowCount().then((counts) => json({ ok: true, ...counts }));
  }
  return json({ ok: false, reason: 'unknown-action' }, 400);
}
