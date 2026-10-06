/**
 * The routes that let a test damage a board and put it back.
 *
 * They are compiled into the Worker but are not routes unless the `TEST_HOOKS`
 * binding is `"1"` — set on the command line by the dev servers the tests start
 * (`playwright.config.ts`, `tests/e2e/helpers/wrangler-process.ts`), never by
 * `wrangler.jsonc`, never in production. Without it the answer to every one of
 * these paths is the plain 404 this file gives for an unknown route: not 403, which
 * would confirm that the board in the address is real and that the caller was
 * refused. `tests/e2e/test-routes.spec.ts` starts a server without the variable and
 * asks all five, because a configuration file can be read and a command line has to
 * be tested.
 *
 * Every hook goes through the same `BoardStore` and the same model functions an
 * ordinary change goes through, because a hook that wrote around them would prove
 * nothing about the board a client gets. Four things, all of them things a test
 * cannot reach from outside a Durable Object:
 *
 * - `corrupt-snapshot` — damage the snapshot, keeping what was there;
 * - `repair` — put it back;
 * - `compact` — fold the log into a snapshot now, whatever the thresholds say;
 * - `seed` — fill the board with notes;
 * - `state` — say what the board's rows are, and nothing else.
 */

import * as Y from 'yjs';

import { createSticky, getStickyText, initDoc } from '../shared/board-model.js';
import { STICKY_COLOR_NAMES } from '../shared/config.js';
import type { BoardStore } from './board-store.js';
import type { RoomDebugState } from './room-state.js';

/** Where the test routes are mounted. */
export const TEST_HOOK_PREFIX = '/__test/boards/';

/**
 * The origin of a change a test route made to a board.
 *
 * To the room, a change to the board is something that came off one of its sockets -
 * that is the rule that keeps the board being read back out of the log. A change made
 * here is not something a person typed, but it is a change to the board in every way
 * that matters: it came in through the model functions, it belongs in storage, and
 * everybody on the board has to be told about it. So it asks to be treated as one, and
 * says so with this origin. Without it the room would file these writes with the load
 * they resemble and never store them, and a seeded board would be a board that forgot
 * as soon as it was left.
 */
export const TEST_HOOK_ORIGIN: unique symbol = Symbol('vidi6-test-hook');

const ACTIONS = ['corrupt-snapshot', 'repair', 'compact', 'seed', 'state'] as const;

/** One of the test routes. */
export type TestHookAction = (typeof ACTIONS)[number];

/** A test route: the action and the board it is for. */
export interface TestHook {
  action: TestHookAction;
  boardId: string;
}

/**
 * `/__test/boards/<board id>/<action>`, or `undefined` for every other path. The
 * board id is not validated here: the room checks it the same way it checks one in
 * a WebSocket URL, so a hook cannot be used to reach a board the URL rules reject.
 */
export function testHookOf(pathname: string): TestHook | undefined {
  if (!pathname.startsWith(TEST_HOOK_PREFIX)) return undefined;
  const parts = pathname.slice(TEST_HOOK_PREFIX.length).split('/');
  if (parts.length !== 2) return undefined;
  const [boardId, action] = parts as [string, string];
  if (!(ACTIONS as readonly string[]).includes(action)) return undefined;
  return { boardId, action: action as TestHookAction };
}

/**
 * The room, as far as a hook is concerned. Everything a hook may touch, and
 * nothing else: it has no way to broadcast, no way to close a socket, and no way
 * to write an update that a client made.
 */
export interface TestRoom {
  /** Whether the `TEST_HOOKS` binding is on. The only gate these routes have. */
  readonly hooksEnabled: boolean;
  readonly store: BoardStore;
  /** The board's own storage, for the statements that are about rows, not boards. */
  readonly storage: DurableObjectStorage;
  /** The board this object is holding, if it is holding one. */
  document(): Y.Doc | undefined;
  /**
   * Drop the board this object is holding, as an evicted object has dropped it.
   * Corrupting uses it: a room that has already read the board would otherwise go
   * on serving the copy it read, which is right for a client and useless for a test
   * that wants to see what damaged storage does.
   */
  hibernate(): void;
  /** What this room is, for the response body. */
  state(): RoomDebugState;
}

/**
 * Answer a test route, or return `undefined` when this request is not one. Called
 * first in `BoardRoom.fetch`, before any WebSocket check.
 */
export function handleTestHook(
  request: Request,
  room: TestRoom,
): Response | Promise<Response> | undefined {
  const hook = testHookOf(new URL(request.url).pathname);
  if (hook === undefined) return undefined;

  if (!room.hooksEnabled) {
    // The route does not exist in this deployment. Not 403 — a client that was not
    // given the route should not be told the board behind it is real.
    return new Response('not found', { status: 404 });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'test hooks are POSTed' }, 405);
  }

  switch (hook.action) {
    case 'corrupt-snapshot':
      return corruptSnapshot(room);
    case 'repair':
      return repairSnapshot(room);
    case 'compact':
      return compact(room);
    case 'seed':
      return seed(room, request);
    case 'state':
      // The room's own debug state, with nothing done to the room first. A test that
      // wants to know whether a change it made is in storage - before it kills the
      // process, say - has to ask from outside the process, because inside the process
      // the board is in memory and looks saved either way.
      return json({ ok: true, ...room.state() });
  }
}

/* ------------------------------------------------------------------------ the routes */

/**
 * Damage the snapshot and save the bytes that were in it.
 *
 * The whole snapshot is saved, not just the first chunk, and the first chunk is
 * what gets overwritten: it is the beginning of the board, so nothing after it can
 * be read either, and the room's only honest answer is that the board could not be
 * loaded. The saved rows are what `repair` puts back.
 */
function corruptSnapshot(room: TestRoom): Response {
  const rows = backupRows(room.storage);
  if (rows.length === 0) {
    return json({ ok: false, error: 'this board has no snapshot to corrupt' }, 409);
  }
  const first = rows[0];
  if (first === undefined) return json({ ok: false, error: 'no snapshot' }, 409);

  room.storage.transactionSync(() => {
    rememberChunks(room.storage, rows);
    room.storage.sql.exec(
      `UPDATE snapshot_chunks SET data = ? WHERE idx = ?`,
      unreadableBytes(first.bytes),
      first.idx,
    );
  });
  // The room has the board in memory and would keep serving it. Forget it, so what
  // happens next is what happens to a board read from the storage we just damaged.
  room.hibernate();
  return json({ ok: true, chunks: rows.length, damaged: first.idx });
}

/** Put the saved snapshot back. */
function repairSnapshot(room: TestRoom): Response {
  const saved = room.storage.sql
    .exec<{ idx: number }>(`SELECT idx FROM test_snapshot_backup ORDER BY idx ASC`)
    .toArray();
  if (saved.length === 0) {
    return json({ ok: false, error: 'nothing was saved for this board' }, 409);
  }
  room.storage.transactionSync(() => {
    for (const row of saved) {
      const data = room.storage.sql
        .exec<{ data: ArrayBuffer }>(`SELECT data FROM test_snapshot_backup WHERE idx = ?`, row.idx)
        .toArray()[0];
      if (data === undefined) continue;
      room.storage.sql.exec(`UPDATE snapshot_chunks SET data = ? WHERE idx = ?`, data.data, row.idx);
    }
    room.storage.sql.exec(`DELETE FROM test_snapshot_backup`);
  });
  // The board is readable again. The room is sitting in `load-failed`, and the next
  // connection that is old enough to retry will read it and serve it; that wait is
  // the retry interval, and it is the thing being tested, so nothing is done here.
  return json({ ok: true, restored: saved.length });
}

/** Fold the log into a snapshot now: a board whose damage is in its snapshot has to have one. */
function compact(room: TestRoom): Response {
  const doc = room.document();
  if (doc === undefined) {
    return json({ ok: false, error: 'this room is not holding a board' }, 503);
  }
  const compacted = room.store.compactNow(doc);
  return json({ ok: compacted, ...room.state() });
}

/**
 * Fill the board with notes, through the model functions the client uses. The
 * board's own update path writes every one of them to storage, which is the point:
 * a seeded board is an ordinary board, and the e2e suite gets to open a big one
 * without a human clicking two thousand times.
 *
 * `texts` is what the notes are filled with, cycled through, when the test wants to
 * say afterwards what each of them said - which is the only way a test of a 2,000-note
 * board can claim the *content* came back and not just the count. The words come from
 * the caller rather than from here, so no test data is compiled into the Worker.
 * `textLength` is the same thing for a test that only cares about size.
 */
function seed(room: TestRoom, request: Request): Response | Promise<Response> {
  const doc = room.document();
  if (doc === undefined) {
    return json({ ok: false, error: 'this room is not holding a board' }, 503);
  }
  return readJson(request)
    .then((body) => {
      const notes = numberIn(body['notes'], 1, 20_000);
      const textLength = numberIn(body['textLength'], 0, 2_000);
      const texts = textsIn(body['texts']);
      const added = addNotes(doc, notes, textLength, texts);
      return json({ ok: true, added, ...room.state() });
    })
    .catch((error: unknown) => json({ ok: false, error: String(error) }, 400));
}

/* ------------------------------------------------------------------------ helpers */

/**
 * `notes` sticky notes, spread over the board in the six colours, with text. Each one is
 * written as two transactions under `TEST_HOOK_ORIGIN` - the note and its text - which is
 * what a person's note costs in the log, so a seeded board is an ordinary board and its
 * row counts mean what a client's row counts mean.
 *
 * The places are 220 units apart in rows of fifty, so no two notes land on top of each
 * other and a test can ask whether every note kept its own corner of the board.
 */
function addNotes(doc: Y.Doc, notes: number, textLength: number, texts: string[]): number {
  initDoc(doc);
  const filler = 'x'.repeat(textLength);
  let added = 0;
  for (let index = 0; index < notes; index += 1) {
    const color = STICKY_COLOR_NAMES[index % STICKY_COLOR_NAMES.length];
    const text = texts.length > 0 ? (texts[index % texts.length] ?? '') : filler;
    let id: string | false = false;
    doc.transact(() => {
      id = createSticky(doc, { x: (index % 50) * 220, y: Math.floor(index / 50) * 220 }, color);
    }, TEST_HOOK_ORIGIN);
    if (id === false) continue;
    const note = id;
    if (text !== '') {
      doc.transact(() => {
        getStickyText(doc, note)?.insert(0, text);
      }, TEST_HOOK_ORIGIN);
    }
    added += 1;
  }
  return added;
}

/** A chunk's worth of bytes that no decoder will accept. */
function unreadableBytes(length: number): ArrayBuffer {
  // 217 is 0b11011001: a var-uint continuation byte on every position, so reading
  // the update runs off the end of it. Whatever the decoder says, it does not say
  // "this is a board".
  return new Uint8Array(Math.max(1, length)).fill(217).buffer;
}

type ChunkRow = { idx: number; bytes: number };

const backupRows = (storage: DurableObjectStorage): ChunkRow[] =>
  storage.sql
    .exec<ChunkRow>(`SELECT idx, LENGTH(data) AS bytes FROM snapshot_chunks ORDER BY idx ASC`)
    .toArray();

/** Keep the snapshot's rows, so a damaged one can be put back. Survives this
 * process, which is more than an in-memory copy would. */
function rememberChunks(storage: DurableObjectStorage, rows: ChunkRow[]): void {
  storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS test_snapshot_backup (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`,
  );
  storage.sql.exec(`DELETE FROM test_snapshot_backup`);
  for (const row of rows) {
    const data = storage.sql
      .exec<{ data: ArrayBuffer }>(`SELECT data FROM snapshot_chunks WHERE idx = ?`, row.idx)
      .toArray()[0];
    if (data === undefined) continue;
    storage.sql.exec(
      `INSERT OR REPLACE INTO test_snapshot_backup (idx, data) VALUES (?, ?)`,
      row.idx,
      data.data,
    );
  }
}

/** A JSON request body, or an empty object if there is nothing to read. */
function readJson(request: Request): Promise<Record<string, unknown>> {
  return request
    .text()
    .then((text) => (text.trim() === '' ? {} : (JSON.parse(text) as Record<string, unknown>)));
}

/**
 * The texts a seed was given. Anything that is not a list of strings is no texts at
 * all, and each one is kept to the length the filler could have been: a hook should not
 * be able to put a 10 MB note on a board.
 */
function textsIn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.slice(0, 2_000));
}

/** A number from a hook body, kept inside the range a test could mean. */
const numberIn = (value: unknown, min: number, max: number): number => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.trunc(number)));
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });


