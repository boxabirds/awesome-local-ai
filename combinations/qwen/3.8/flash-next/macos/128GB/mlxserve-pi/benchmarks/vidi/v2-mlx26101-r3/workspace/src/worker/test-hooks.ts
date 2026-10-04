/**
 * Test hooks: ways for the browser suite to damage a board's storage on purpose.
 *
 * Story 4's promise is what happens when a board comes back, and the interesting half of it is
 * what happens when it *doesn't*. A damaged board cannot be made from outside a Durable Object -
 * only the object can touch its own storage - so the suite asks the object to do it, through a
 * route that exists only when the deployment says it may.
 *
 * ## Only when it is asked for
 *
 * Nothing here is reachable unless the Worker's environment says `TEST_HOOKS=1`. That variable is
 * set on the development server the e2e suite starts (`playwright.config.ts`, with `--var`), and
 * nowhere else: not in `wrangler.jsonc`, not in the preview server, not in a deployment. A request
 * to `/__test/...` without it is not routed here at all and ends up at the assets, which is what
 * makes the production answer to that URL be the app rather than a damage switch.
 *
 * The gate is checked twice, in the two places that can enforce it: in the Worker, before the
 * request is sent to a Durable Object, and in the room itself, before it touches its own storage.
 * The second one is not redundancy - the room's storage can be reached by anything that can send it
 * a request, and a room should not do this because somebody asked nicely in a way this file failed
 * to notice.
 *
 * ## What the steps are for
 * `compact`
 *   Fold the log up now. A snapshot would appear by itself after COMPACTION_UPDATE_COUNT changes,
 *   which for a 25-note board made through a browser means several thousand clicks; and the thing
 *   under test is a damaged *snapshot*, so a snapshot has to exist.
 * `corrupt-snapshot`
 *   Write bytes that are not a board over the first chunk of the snapshot, keeping the original so
 *   it can be put back. This is the damage a board can suffer for real - a row that arrived
 *   truncated, or that a restore left half-written - made on purpose, and it is done to the stored
 *   bytes rather than to the store's own code, so nothing about how the board is read is being
 *   mocked.
 * `repair-snapshot`
 *   Put the original back. The interesting part of the story is not that a broken board says so, it
 *   is that a board that says so and is then fixed comes back on its own, with nobody reloading.
 * `read-again`
 *   Forget the board in memory and read it from storage again, which is what a wake does. Without
 *   this, a damaged board could only be tested by restarting the whole dev server, and only in the
 *   one project that is allowed to. That is worth having - TC-19 and TC-20 do it that way, against
 *   a process that really lost its memory - and it is worth being able to ask a single board to do
 *   it without taking the other boards down with it, which is what this is. It is the room's own
 *   wake path, entered through the two transitions a quiet room is in anyway (`hibernate`, then
 *   `wake`), and it refuses to run while anybody is connected, because a room being woken is a room
 *   nobody is looking at.
 */

/** The steps a test can ask a room to run, in the order the story's workflow uses them. */
export const ROOM_TEST_STEPS = [
  'compact',
  'corrupt-snapshot',
  'repair-snapshot',
  'read-again',
] as const;

export type RoomTestStep = (typeof ROOM_TEST_STEPS)[number];

/** `/__test/boards/<boardId>/<step>` - what the suite asks the Worker to hand to a room. */
const WORKER_TEST_PATH = /^\/__test\/boards\/([^/]+)\/([^/]+)$/;

/** Where the room's own door is, and the step it is being asked to run. */
const ROOM_TEST_PATH = /^\/internal\/test\/([^/]+)$/;

/** The bytes that are not a board. */
const NOT_A_BOARD = 'this is not a yjs update';

/**
 * Where the original chunk goes while the damage is in place. Its own table, of its own
 * accord: nothing in the board's schema knows about it, and nothing but these hooks ever
 * writes to it or reads from it.
 */
const SAVED_TABLE = 'test_hook_saved';
const SAVED_CHUNK = 'snapshot_chunks:0';

/** The bit of the environment these hooks care about. */
export interface TestHookEnv {
  TEST_HOOKS?: string;
}

/** The room, as far as these hooks are concerned: only its storage, and only to damage it. */
export interface RoomStorage {
  storage: DurableObjectStorage;
}

/** What a step says back. Always JSON, so a test can read the reason a step was refused. */
export function report(ok: boolean, detail: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok, ...detail }), {
    status: ok ? 200 : 409,
    headers: { 'content-type': 'application/json' },
  });
}

/** True when this deployment was started with the switches turned on. */
export function areEnabled(env: TestHookEnv): boolean {
  return env.TEST_HOOKS === '1';
}

/** The board and step in a request path, or `null` when the path is not a test switch. */
export function testSwitchIn(pathname: string): { boardId: string; step: RoomTestStep } | null {
  const match = WORKER_TEST_PATH.exec(pathname);
  const raw = match?.[1];
  const named = match?.[2];
  if (raw === undefined || named === undefined) {
    return null;
  }
  const step = ROOM_TEST_STEPS.find((candidate) => candidate === named);
  if (step === undefined) {
    return null;
  }
  try {
    return { boardId: decodeURIComponent(raw), step };
  } catch {
    // A path that is not even a name is not a board either.
    return null;
  }
}

/** The step in a request the room was sent, or `null` when it is not one of these. */
export function roomTestStepIn(pathname: string): RoomTestStep | null {
  const match = ROOM_TEST_PATH.exec(pathname);
  const named = match?.[1];
  if (named === undefined) {
    return null;
  }
  return ROOM_TEST_STEPS.find((candidate) => candidate === named) ?? null;
}

/**
 * How many chunks this board's snapshot is in: zero when there is no snapshot yet.
 *
 * The fold-up itself is the room's and its store's to run - they own the document and the counters
 * - and this is only what a test reads back afterwards to know that the snapshot it means to
 * damage is really there.
 */
export function snapshotChunks(storage: RoomStorage): number {
  for (const row of storage.storage.sql.exec('SELECT COUNT(*) AS n FROM snapshot_chunks')) {
    return Number(row.n);
  }
  return 0;
}

/**
 * Write bytes that are not a board over the first chunk of the snapshot, keeping the original.
 *
 * The first chunk is enough to make the snapshot unreadable, which is the whole damage: the board
 * is read as one piece, so a piece that is not the board is a board that cannot be read.
 */
export function damageSnapshot(storage: RoomStorage): {
  bytes: number;
  saved: boolean;
} {
  const sql = storage.storage.sql;
  let original: ArrayBuffer | null = null;
  for (const row of sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0')) {
    original = row.data as ArrayBuffer;
  }
  if (original === null) {
    throw new Error('this board has no snapshot to damage: compact it first');
  }
  const damaged = new TextEncoder().encode(NOT_A_BOARD);
  storage.storage.transactionSync(() => {
    sql.exec(`CREATE TABLE IF NOT EXISTS ${SAVED_TABLE} (name TEXT PRIMARY KEY, data BLOB NOT NULL)`);
    sql.exec(`INSERT OR REPLACE INTO ${SAVED_TABLE} (name, data) VALUES (?, ?)`, SAVED_CHUNK, original);
    sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', damaged);
  });
  return { bytes: original.byteLength, saved: true };
}

/**
 * Put the original first chunk back, and stop pretending the board is damaged.
 *
 * `repaired` false is reported when nothing was waiting to be put back - either the board was
 * never damaged, or it has since been folded up again, which would have written a fresh snapshot
 * over the top of the damage. The second of those is worth knowing about: a test that repaired a
 * board that had since healed itself would be watching a recovery that had nothing to recover
 * from.
 */
export function repairSnapshot(storage: RoomStorage): { repaired: boolean } {
  const sql = storage.storage.sql;
  let original: ArrayBuffer | null = null;
  try {
    for (const row of sql.exec(`SELECT data FROM ${SAVED_TABLE} WHERE name = ?`, SAVED_CHUNK)) {
      original = row.data as ArrayBuffer;
    }
  } catch {
    // The table is only there once a damage has been done. No table, nothing was damaged.
    return { repaired: false };
  }
  if (original === null) {
    return { repaired: false };
  }
  storage.storage.transactionSync(() => {
    sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original as ArrayBuffer);
    sql.exec(`DELETE FROM ${SAVED_TABLE} WHERE name = ?`, SAVED_CHUNK);
  });
  return { repaired: true };
}
