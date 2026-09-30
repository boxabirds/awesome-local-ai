// Copyright 2026 Board Room contributors. All rights reserved.
//
// The story 4 test hooks: an HTTP surface that damages a board's stored snapshot
// and puts it back, so a test can ask what a page does with a board it cannot
// load (PRD persist.corrupt_update, TC-24) without waiting for storage to decay.
//
// This is the only file in the Worker that writes broken bytes on purpose, and
// the only thing that reaches it is a route the Worker serves *only* when it was
// run with `TEST_HOOKS=1` — which `wrangler.jsonc` never sets, so a deployed
// Worker answers these paths with the client. (The room methods the route calls
// are compiled in: a Worker reads its environment at run time, so there is no
// build step a hook could be dropped from. What production lacks is the route,
// and `npm run test:e2e` asserts a request to it changes nothing.)
//
// Spec: spec/stories/004-return-to-a-board-and-find-everything-as-it-was-le/
// design.md, section Fixtures — "tests/e2e/helpers/broken-board.ts + a test-only
// storage corruption/repair endpoint".
import type { Env } from './index';
import { isValidBoardId } from '../shared/board-id';
import { TEST_CHUNK_BACKUP_KEY } from './board-store';
import type { BoardStorage } from './board-store';

/** The environment variable that turns the routes on. Set by the e2e suite's own
 * `wrangler dev` (`--var TEST_HOOKS:1`) and by nothing else. */
export const TEST_HOOKS_ENV = 'TEST_HOOKS';

/** What a test can ask for. */
export type TestHookKind = 'compact' | 'corrupt-snapshot' | 'repair-snapshot';

/**
 * The hooks that are not a storage fault: `initialize` makes a board exist at a
 * chosen id (the e2e suite needs a board at a known address, and only `POST
 * /api/boards` — which invents its own id — otherwise makes one); `seed-legacy`
 * seeds a board with real Yjs updates and no `created_at`, so a board made before
 * story 5 can be opened (share.legacy_boards, TC-31). Kept apart from
 * {@link TestHookKind} so the room's own storage-fault hook switch stays what it was.
 */
export type SeedHookKind = 'initialize' | 'seed-legacy';

/** Every hook name the route understands. */
type HookName = TestHookKind | SeedHookKind;

// The hook is a query parameter on the room's own address —
// `POST /api/rooms/<boardId>?__test=compact` — and that is not a stylistic choice.
// In `wrangler dev`, with `assets.not_found_handling = "single-page-application"`,
// the assets router answers anything that is not *exactly* the room path before
// the Worker is asked: `/api/__test/...`, `/api/rooms/<id>/compact` and any other
// longer path gets the SPA fallback (a GET) or `405 Method Not Allowed` (a POST),
// and the hook is never reached. The one address the Worker is sure to be asked
// about is the room's own, so the hooks are hung off it, and a request that has
// the parameter is a hook and nothing else.
const HOOK_PARAM = '__test';
const ROOM_PATH = /^\/api\/rooms\/([^/?#]+)$/;
const HOOK_KINDS: readonly string[] = [
  'compact',
  'corrupt-snapshot',
  'repair-snapshot',
  'initialize',
  'seed-legacy',
];

/** What a hook reports: whether it did the thing, and why not if it did not. */
export interface TestHookResult {
  ok: boolean;
  reason?: string;
}

/**
 * Read the hook out of a request URL: the room's address plus `?__test=<kind>`.
 * Returns null for everything else, including the room's WebSocket connection,
 * which carries no such parameter.
 */
/** A hook address: which board, and which hook — `null` kind being a hook name
 * this build does not have, which is a 400 rather than a "not a hook". */
export interface ParsedTestHook {
  boardId: string;
  kind: HookName | null;
}

export const parseTestHook = (url: URL): ParsedTestHook | null => {
  const requested = url.searchParams.get(HOOK_PARAM);
  if (requested === null) return null;
  const match = ROOM_PATH.exec(url.pathname);
  if (match === null) return null;
  return {
    boardId: match[1] as string,
    kind: HOOK_KINDS.includes(requested) ? (requested as HookName) : null,
  };
};

/**
 * Answer a hook request, or return null when this request is not a hook request
 * and the Worker should go on with what it would normally do with it.
 */
export async function handleTestHook(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const hook = parseTestHook(new URL(request.url));
  if (hook === null) return null;
  if (hook.kind === null || !isValidBoardId(hook.boardId)) {
    return Response.json(
      { ok: false, reason: 'that is not a board and a hook' },
      { status: 400 },
    );
  }
  if (request.method !== 'POST') {
    return Response.json(
      { ok: false, reason: 'a test hook is a POST' },
      { status: 405 },
    );
  }

  // The same lookup a board connection goes through: the board id is the object's
  // name, so the hook can only ever reach into its own board's storage.
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(hook.boardId));

  // `initialize` makes a board exist at this id, through the same creation the
  // real endpoint runs. It is how the suite puts a board at an address it chose,
  // so a scenario can restart its own server and find the board again there.
  if (hook.kind === 'initialize') {
    const created = await stub.initialize();
    return Response.json({ ok: true, created }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // `seed-legacy` is the one hook with a body: the real Yjs updates to write, so
  // the suite can arrange a board that predates the created_at marker. It writes
  // them and never marks the board created, exactly like a board from before
  // story 5 (share.legacy_boards, TC-31).
  if (hook.kind === 'seed-legacy') {
    const body = (await request.json()) as { updates?: unknown };
    const updates = Array.isArray(body.updates)
      ? body.updates.filter((u): u is string => typeof u === 'string')
      : [];
    if (updates.length === 0) {
      return Response.json({ ok: false, reason: 'no updates to seed' }, { status: 400 });
    }
    const seeded = await stub.seedLegacy(updates);
    return Response.json(seeded, {
      status: seeded.ok ? 200 : 409,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const result = await stub.testHook(hook.kind);
  return Response.json(result, {
    status: result.ok ? 200 : 409,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * A snapshot chunk bigger than this is not corrupted: the original is kept as
 * text in `storage_meta` so the repair hook has something to put back, and a
 * chunk of that size would not fit there. The hooks are for small boards.
 */
export const TEST_HOOK_MAX_CHUNK_BYTES = 256 * 1024;

/**
 * Bytes no Yjs decoder accepts, of the same length as the chunk it replaces.
 * `0xff` is not random: a fixed fill fails at the same place every run, so a
 * failing TC-24 stays reproducible.
 */
const undecodable = (length: number): Uint8Array => new Uint8Array(length).fill(0xff);

const toText = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
};

const fromText = (value: string): Uint8Array => {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

/** The one chunk a snapshot's first chunk, or null when there is no snapshot. */
const chunkZero = (storage: BoardStorage): Uint8Array | null => {
  const rows = storage.sql.exec(
    'SELECT data FROM snapshot_chunks WHERE idx = 0',
  ).toArray();
  if (rows.length === 0) return null;
  return new Uint8Array(rows[0]!['data'] as ArrayBuffer);
};

/**
 * Damage this board's snapshot, and put the room where anybody else with a
 * damaged board is: unable to load it.
 *
 * Damaging storage is not enough by itself — the room still holds a healthy
 * document in memory and would go on serving from it, which no real corruption
 * scenario allows. So the hook reads the board back afterwards through
 * `reload`, the same path a wake takes: the load fails, the room goes
 * LoadFailed, and its next connection is refused with CLOSE_BOARD_LOAD_FAILED.
 */
export function corruptSnapshot(
  storage: BoardStorage,
  reload: () => void,
): TestHookResult {
  const chunk = chunkZero(storage);
  if (chunk === null) {
    return { ok: false, reason: 'this board has no snapshot to corrupt' };
  }
  if (chunk.byteLength > TEST_HOOK_MAX_CHUNK_BYTES) {
    return { ok: false, reason: 'this snapshot chunk is too big for the test hook' };
  }
  // The original goes somewhere the repair hook can find without a second
  // table. The key only ever exists while a hook has a board damaged.
  storage.sql.exec(
    'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
    TEST_CHUNK_BACKUP_KEY,
    toText(chunk),
  );
  const damaged = undecodable(chunk.byteLength);
  storage.sql.exec(
    'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
    damaged.slice().buffer,
  );
  reload();
  return { ok: true };
}

/**
 * Undo {@link corruptSnapshot}: put the original chunk back, forget the backup,
 * and read the board again. A client that is already retrying gets the board on
 * its next connection, with nobody pressing reload (TC-24).
 */
export function repairSnapshot(
  storage: BoardStorage,
  reload: () => void,
): TestHookResult {
  const rows = storage.sql.exec(
    'SELECT value FROM storage_meta WHERE key = ?',
    TEST_CHUNK_BACKUP_KEY,
  ).toArray();
  if (rows.length === 0) {
    return { ok: false, reason: 'nothing was damaged here' };
  }
  const original = fromText(String(rows[0]!['value']));
  storage.sql.exec(
    'INSERT OR REPLACE INTO snapshot_chunks (idx, data) VALUES (0, ?)',
    original.slice().buffer,
  );
  storage.sql.exec('DELETE FROM storage_meta WHERE key = ?', TEST_CHUNK_BACKUP_KEY);
  reload();
  return { ok: true };
}
