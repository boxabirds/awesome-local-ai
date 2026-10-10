/**
 * Test-only routes (see story 4's design: "registered only when
 * `env.TEST_HOOKS === '1'`, set only in the e2e wrangler environment, never in
 * production config").
 *
 * Story 5 makes board existence a product fact — a link either names a board or
 * it does not — so a browser test can no longer invent a board by typing an
 * address. What it can still do, with the switch off everywhere else, is ask the
 * service for a board in a shape the product no longer produces on its own:
 *
 * - `POST /__test/boards/:id/seed-legacy` — a board with logged changes and no
 *   `created_at`, i.e. one that was already there before this story shipped
 *   (share.legacy_boards, TC-31).
 *
 * The rows are written through `BoardStore` with real `board-model` calls, so
 * the board a test then opens is made of the bytes the product writes, not of a
 * shape a test hoped for.
 */
import * as Y from 'yjs';

import { createSticky, getStickyText, initDoc } from '../shared/board-model';
import { isValidBoardId } from '../shared/board-id';
import { STICKY_SIZE_WORLD } from '../shared/config';

import type { Env } from './index';
import type { BoardStore } from './board-store';

/** The variable that switches these routes on. Absent means off. */
export const TEST_HOOKS_VAR = 'TEST_HOOKS';

/** `POST /__test/boards/<id>/seed-legacy`. */
export const SEED_LEGACY_PATH = /^\/__test\/boards\/([^/]+)\/seed-legacy$/;

/** The environment shape these routes look at (plain vars, no bindings). */
export interface TestHooksEnv {
  TEST_HOOKS?: string;
}

/** Are the test routes live? Only ever true on the test servers. */
export function testHooksEnabled(env: TestHooksEnv): boolean {
  return env.TEST_HOOKS === '1';
}

/** Refusal when something asks for a test route with the switch off. */
export function testHooksDisabledResponse(): Response {
  return Response.json({ error: 'test_hooks_disabled' }, { status: 404 });
}

/** The notes the hook writes, in creation order, with room between them. */
export interface LegacyNote {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

/** The board `seedLegacyBoard` writes, as data a test can assert against. */
export function legacyNotes(count: number): LegacyNote[] {
  return Array.from({ length: count }, (_unused, index) => ({
    text: `Legacy note ${index + 1}`,
    // Top-left, in world units: `createSticky` is given the centre and stores
    // the top-left, so this is what the board reports back (story 4's lesson).
    x: 120 + index * (STICKY_SIZE_WORLD + 60),
    y: 160,
  }));
}

/**
 * The updates a board would have if someone had drawn `count` notes on it and
 * every change had been logged — one Yjs update per change, from a real client
 * clock, through the real board model.
 */
export function legacyUpdates(count: number): Uint8Array[] {
  const updates: Uint8Array[] = [];
  const collect = (update: Uint8Array): void => {
    updates.push(update.slice());
  };
  // Listening first and initialising second: the transaction that sets the board
  // up is the first thing a real client logged, and a log that starts after it is
  // a board whose contents nobody can index (measured: without this update the
  // notes are there and `snapshot()` answers nothing).
  const doc = new Y.Doc();
  doc.on('update', collect);
  initDoc(doc);
  for (const note of legacyNotes(count)) {
    // One transaction per note, as a client does: `count` separate rows, not one
    // big one, because that is what a log of a used board looks like.
    doc.transact(() => {
      const id = createSticky(doc, {
        x: note.x + STICKY_SIZE_WORLD / 2,
        y: note.y + STICKY_SIZE_WORLD / 2,
      });
      if (typeof id !== 'string') throw new Error(`createSticky refused ${JSON.stringify(note)}`);
      getStickyText(doc, id)?.insert(0, note.text);
    });
  }
  doc.off('update', collect);
  doc.destroy();
  return updates;
}

/** What the hook reports: enough for a test to check it wrote what it meant. */
export interface SeedResult {
  readonly notes: number;
  readonly rows: number;
  readonly created_at: false;
  /**
   * The texts of the notes it wrote, in creation order. They come back with the
   * response so a browser test asserts the screen against what the server knows
   * it wrote, instead of keeping its own copy of the fixture to hope they agree.
   */
  readonly texts: string[];
}

/**
 * Write `count` notes into a board's storage as logged updates, and *do not*
 * write `created_at` — the whole point of the fixture is a board that exists by
 * its content alone (share.legacy_boards).
 */
export function seedLegacyBoard(store: BoardStore, count: number): SeedResult {
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new Error(`notes must be a whole number between 1 and 200, got ${count}`);
  }
  const updates = legacyUpdates(count);
  // `migrate` (not `initialize`): the tables without the `created_at` row, which
  // is exactly the state a board from before story 5 is in.
  store.migrate();
  for (const update of updates) store.append(update);
  return {
    notes: count,
    rows: updates.length,
    created_at: false,
    texts: legacyNotes(count).map((note) => note.text),
  };
}

/** Reject a bad id before it reaches any storage. */
export function isUsableBoardId(id: string): boolean {
  return isValidBoardId(id);
}

/**
 * `POST /__test/boards/:id/seed-legacy`, i.e. the route a browser test uses to
 * put a board back into its pre-story-5 shape. Only ever reached when
 * `TEST_HOOKS=1` (checked by the caller), and only ever *writes to a board that
 * a test names*, which no product route does.
 */
export async function seedLegacyBoardRoute(
  request: Request,
  env: Env,
  boardId: string,
): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }
  if (!isUsableBoardId(boardId)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { notes?: unknown };
  const count = typeof body.notes === 'number' ? body.notes : 3;
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  try {
    const seeded = await room.testSeedLegacy(count);
    return Response.json({ id: boardId, ...seeded }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: 'seed_failed', message }, { status: 500 });
  }
}
