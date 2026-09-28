// Story 4 integration: the BoardRoom Durable Object against real Durable Object
// SQLite storage, with real Yjs clients on real sockets.
//
// The room is inspected with runInDurableObject, which runs a callback against
// the live instance - so every number asserted here is read out of the room's
// own SQLite (COUNT/SUM over the real tables), not out of a mock.
//
// "A wake-up" is simulated with the room's own testReload(): it throws the
// in-memory document away and reads the board again, which is what a woken
// instance does. Nothing can ask the runtime to evict itself, so this is the
// honest stand-in - and it goes through the same constructor load.
//
// Row assertions are written as deltas measured immediately before the action
// being tested. A client's own SyncStep2 reply is a real Yjs update and is
// appended like any other, so the absolute row count is one row per connection
// plus one per change; what must be exact is the DELTA an action causes.
import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id.ts';
import { createSticky } from '../../src/shared/board-model.ts';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol.ts';
import {
  COMPACTION_UPDATE_COUNT,
  LOAD_RETRY_MIN_INTERVAL_MS,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config.ts';
import { STORAGE_SCHEMA_VERSION } from '../../src/worker/board-store.ts';
import { BoardRoom, type RoomStats } from '../../src/worker/board-room.ts';
import { TestClient, tick } from './helpers/ws-client.ts';
import { buildBoardUpdateLargerThan, sameBoard } from '../fixtures/boards.ts';

const { BOARD_ROOM } = env as unknown as { BOARD_ROOM: DurableObjectNamespace<BoardRoom> };

const stubFor = (boardId: string): DurableObjectStub<BoardRoom> =>
  BOARD_ROOM.get(BOARD_ROOM.idFromName(boardId));

const inRoom = <T>(
  boardId: string,
  fn: (room: BoardRoom, state: DurableObjectState) => T | Promise<T>,
): Promise<T> => runInDurableObject(stubFor(boardId), fn);

const statsOf = (boardId: string): Promise<Stats> => inRoom(boardId, (room) => room.testStats());

// Connections the Durable Object itself is holding - hibernation, not a JS Set.
const openSockets = (boardId: string): Promise<number> =>
  inRoom(boardId, (_room, state) => state.getWebSockets().length);

type Stats = RoomStats;

const storedBytes = (s: Stats): number => s.logBytes + s.chunkSizes.reduce((sum, n) => sum + n, 0);

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await tick(10);
  }
}

async function waitForStats(
  boardId: string,
  predicate: (s: Stats) => boolean,
  what: string,
  timeoutMs = 30000,
): Promise<Stats> {
  let latest: Stats | undefined;
  await waitFor(() => {
    return statsOf(boardId).then((s) => {
      latest = s;
      return predicate(s);
    });
  }, timeoutMs, what);
  return latest as Stats;
}

// A client that closed its own socket is dropped by the room. (In this runtime a
// locally-initiated close gives the client no close event, so the room is asked
// how many connections it still holds, which is the assertion that matters.)
async function socketsDropped(boardId: string, expected = 0): Promise<void> {
  await waitFor(async () => (await openSockets(boardId)) === expected, 5000, `${expected} connection(s) left in the room`);
}

// Create `n` notes through one client's provider path: one local transaction per
// note, so each is a separate update on the wire and a separate row in the log.
function createNotes(client: TestClient, n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(createSticky(client.doc, { x: i * 10, y: i * 5 }));
  return ids;
}

describe('story 4: the board is durable', () => {
  it(
    'TC-13 a note written by a client is served from storage after a wake-up',
    async () => {
      const boardId = newBoardId();
      const a = await TestClient.connect(boardId);
      await a.waitForSync();
      await tick(100); // let the handshake append whatever it appends
      const before = (await statsOf(boardId)).logRows;

      const noteId = createSticky(a.doc, { x: 320, y: 240 }, 'blue');

      // The row is in SQLite before anything else gets to see the note.
      const written = await waitForStats(boardId, (s) => s.logRows === before + 1, 'the update to be appended');
      expect(written.updateCount).toBe(before + 1);

      // The room now throws its memory away and reads the board back, the way a
      // woken instance does.
      const after = await inRoom(boardId, (room) => room.testReload());
      expect(after.lifecycle).toBe('ready');
      // Reading the board back wrote nothing: a wake-up is a read, not a write.
      expect(after.logRows).toBe(before + 1);
      expect(after.updateCount).toBe(before + 1);

      // A client that has never spoken to this room is answered with the stored
      // board in its very first message: it does not have to teach the room
      // anything and then wait for convergence.
      const b = await TestClient.connect(boardId);
      await b.waitForSync();
      expect(b.snapshot().length).toBe(1);
      expect(b.snapshot()[0].id).toBe(noteId);
      expect(b.snapshot()[0].color).toBe('blue');
      expect(sameBoard(b.snapshot(), a.snapshot())).toBe(true);
    },
    30000,
  );

  it(
    'TC-13b the log is appended to before a change is broadcast',
    async () => {
      const boardId = newBoardId();
      const a = await TestClient.connect(boardId);
      const b = await TestClient.connect(boardId);
      await Promise.all([a.waitForSync(), b.waitForSync()]);
      await tick(100); // let both handshakes finish writing whatever they write
      const before = await statsOf(boardId);

      createNotes(a, 3);
      await b.waitFor(() => b.snapshot().length === 3, 5000, 'three notes at b');
      // By the time the peer has seen all three, all three rows are durable.
      const after = await statsOf(boardId);
      expect(after.logRows).toBe(before.logRows + 3);
      expect(after.logBytes).toBeGreaterThan(before.logBytes);
    },
    30000,
  );

  it(
    'TC-14 the log is folded into a snapshot at the threshold and the board survives it',
    async () => {
      const boardId = newBoardId();
      const a = await TestClient.connect(boardId);
      await a.waitForSync();

      const count = COMPACTION_UPDATE_COUNT + 20;
      createNotes(a, count);
      await a.waitFor(() => a.snapshot().length === count, 30000, 'every note at a');

      // Compaction runs off the write path (ctx.waitUntil): the room answers the
      // client first and folds the log afterwards. A flood crosses the threshold
      // in the middle of the stream, so what has to be true is that a fold
      // happened and left less than a threshold's worth of rows behind.
      const folded = await waitForStats(boardId, (s) => s.chunks >= 1, 'the log to be folded');
      expect(folded.throughSeq).toBeGreaterThanOrEqual(COMPACTION_UPDATE_COUNT);
      expect(folded.updateCount).toBeLessThan(COMPACTION_UPDATE_COUNT);
      expect(folded.logRows).toBe(folded.updateCount);
      expect(storedBytes(folded)).toBeGreaterThan(0);
      // A change that arrived while the fold was running is not lost: the fold is
      // one synchronous transaction, so a change is either inside the snapshot or
      // fully after it - never inside neither.
      expect(a.snapshot().length).toBe(count);

      const after = await inRoom(boardId, (room) => room.testReload());
      expect(after.lifecycle).toBe('ready');
      const b = await TestClient.connect(boardId);
      await b.waitForSync();
      expect(b.snapshot().length).toBe(count);
      expect(sameBoard(b.snapshot(), a.snapshot())).toBe(true);
    },
    90000,
  );

  it(
    'TC-15 a snapshot bigger than one chunk is split, and every chunk fits',
    async () => {
      const boardId = newBoardId();
      const board = buildBoardUpdateLargerThan(SNAPSHOT_CHUNK_BYTES);
      expect(board.update.byteLength).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);

      const seeded = await inRoom(boardId, (room) => room.testSeed(board.update));
      expect(seeded.chunks).toBeGreaterThan(1);
      for (const size of seeded.chunkSizes) {
        expect(size).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      }
      // Not a pile of empty rows: the chunks are full, and together they are the
      // snapshot that was written.
      const total = seeded.chunkSizes.reduce((x, y) => x + y, 0);
      expect(total).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
      expect(Math.max(...seeded.chunkSizes)).toBe(SNAPSHOT_CHUNK_BYTES);
      // The log is gone: the whole board is the snapshot now.
      expect(seeded.logRows).toBe(0);

      const reloaded = await inRoom(boardId, (room) => room.testReload());
      expect(reloaded.lifecycle).toBe('ready');
      const client = await TestClient.connect(boardId);
      await client.waitForSync();
      expect(client.snapshot().length).toBe(board.notes);
      expect(sameBoard(client.snapshot(), board.snapshot)).toBe(true);
    },
    60000,
  );

  it(
    'TC-16 a board whose snapshot cannot be read is closed with 4500 and never written',
    async () => {
      const boardId = newBoardId();
      const a = await TestClient.connect(boardId);
      await a.waitForSync();
      createNotes(a, 2);
      await waitForStats(boardId, (s) => s.logRows >= 2, 'two rows');

      // The snapshot the board reads back is now garbage.
      const broken = await inRoom(boardId, (room) => room.testCorruptSnapshot());
      expect(broken.state).toBe('load-failed');
      expect(broken.serving).toBe(false);
      expect(broken.loadError).toBeTruthy();

      // The connected client is told, with the code that keeps it retrying.
      expect(await a.waitForClose()).toBe(CLOSE_BOARD_LOAD_FAILED);

      const frozen = await statsOf(boardId);
      expect(frozen.chunks).toBeGreaterThan(0);
      const bytesBefore = storedBytes(frozen);

      // Anyone who arrives now is refused the same way ...
      const late = await TestClient.connect(boardId);
      expect(await late.waitForClose()).toBe(CLOSE_BOARD_LOAD_FAILED);

      // ... and refusing them wrote nothing at all.
      const after = await statsOf(boardId);
      expect(storedBytes(after)).toBe(bytesBefore);
      expect(after.state).toBe('load-failed');
    },
    30000,
  );

  it(
    'TC-17 the retry is rate limited, and the board comes back once storage is fixed',
    async () => {
      const boardId = newBoardId();
      const a = await TestClient.connect(boardId);
      await a.waitForSync();
      createNotes(a, 1);
      await waitForStats(boardId, (s) => s.logRows >= 1, 'one row');
      a.close();
      await socketsDropped(boardId);

      await inRoom(boardId, (room) => room.testCorruptSnapshot());
      expect((await statsOf(boardId)).state).toBe('load-failed');

      // Inside the retry window a new connection is refused without re-reading
      // storage: the room does not hammer a broken database.
      const soon = await TestClient.connect(boardId);
      expect(await soon.waitForClose()).toBe(CLOSE_BOARD_LOAD_FAILED);

      // The operator puts the bytes back. Nothing is pushed into the room: the
      // next connection re-reads, and serves the board again.
      await inRoom(boardId, (room) => room.testRepairSnapshot());
      await tick(LOAD_RETRY_MIN_INTERVAL_MS + 500);

      const back = await TestClient.connect(boardId);
      await back.waitForSync();
      expect(back.snapshot().length).toBe(1);
      const ok = await statsOf(boardId);
      expect(ok.state).toBe('ready');
      expect(ok.serving).toBe(true);
    },
    30000,
  );

  it(
    'TC-18 a wake-up neither loses nor duplicates a client change',
    async () => {
      const boardId = newBoardId();
      const a = await TestClient.connect(boardId);
      await a.waitForSync();
      await tick(100);
      const before = (await statsOf(boardId)).logRows;

      createNotes(a, 4);
      const four = await waitForStats(boardId, (s) => s.logRows === before + 4, 'four rows');
      expect(four.sockets).toBe(1);

      // The room is woken while the client is still connected ...
      expect((await inRoom(boardId, (room) => room.testReload())).logRows).toBe(before + 4);

      // ... and the client keeps editing: each change is appended once.
      createNotes(a, 2);
      const done = await waitForStats(boardId, (s) => s.logRows === before + 6, 'two more rows');
      expect(done.updateCount).toBe(before + 6);

      // Nobody has to converge afterwards: the wake-up lost nothing.
      const end = await inRoom(boardId, (room) => room.testReload());
      expect(end.logRows).toBe(before + 6);

      const b = await TestClient.connect(boardId);
      await b.waitForSync();
      await b.waitForEqualSnapshot(a);
      expect(b.snapshot().length).toBe(6);

      const c = await TestClient.connect(boardId);
      await c.waitForSync();
      expect(c.snapshot().length).toBe(6);
    },
    60000,
  );

  it(
    'TC-26 a wake-up of a broken board stays broken, and never serves an empty board',
    async () => {
      const boardId = newBoardId();
      const a = await TestClient.connect(boardId);
      await a.waitForSync();
      createNotes(a, 1);
      await waitForStats(boardId, (s) => s.logRows >= 1, 'one row');
      a.close();
      await socketsDropped(boardId);

      await inRoom(boardId, (room) => room.testCorruptSnapshot());
      const first = await statsOf(boardId);
      expect(first.state).toBe('load-failed');

      // A second wake-up reads the same broken bytes and reports the same
      // failure: a retry is a real re-read, never a no-op against memory that is
      // still warm.
      const again = await inRoom(boardId, (room) => room.testReload());
      expect(again.state).toBe('load-failed');
      expect(again.serving).toBe(false);
      expect(again.chunks).toBe(first.chunks);
      expect(again.loadError).toBeTruthy();

      // And nobody is served an empty board in the meantime.
      const client = await TestClient.connect(boardId);
      expect(await client.waitForClose()).toBe(CLOSE_BOARD_LOAD_FAILED);
      expect(client.received.length).toBe(0);
    },
    30000,
  );

  it(
    'a quarantined log row is set aside and the rest of the board loads',
    async () => {
      const boardId = newBoardId();
      const a = await TestClient.connect(boardId);
      await a.waitForSync();
      await tick(100);
      const before = (await statsOf(boardId)).logRows;

      createNotes(a, 1);
      await waitForStats(boardId, (s) => s.logRows === before + 1, 'one row');

      // A row that was never applied to any document: what a torn write is.
      await inRoom(boardId, (room) => room.testPoisonLog());
      const loaded = await inRoom(boardId, (room) => room.testReload());
      expect(loaded.state).toBe('ready');
      expect(loaded.serving).toBe(true);
      expect(loaded.quarantined).toBe(1);
      expect(loaded.logRows).toBe(before + 1); // the poison row left the log

      const b = await TestClient.connect(boardId);
      await b.waitForSync();
      expect(b.snapshot().length).toBe(1);
    },
    30000,
  );

  it(
    'an injected storage failure rolls the append back and closes the board with 1011',
    async () => {
      const boardId = newBoardId();
      const a = await TestClient.connect(boardId);
      const b = await TestClient.connect(boardId);
      await Promise.all([a.waitForSync(), b.waitForSync()]);
      await tick(100);
      const before = (await statsOf(boardId)).logRows;

      // Fail *after* the row is written, so the assertion below is about the
      // Durable Object transaction and not about a write that never started.
      await inRoom(boardId, (room) => room.testFailNextAppend());
      createNotes(a, 1);

      expect(await a.waitForClose()).toBe(CLOSE_STORAGE_FAILURE);
      expect(await b.waitForClose()).toBe(CLOSE_STORAGE_FAILURE);

      const failed = await statsOf(boardId);
      expect(failed.state).toBe('storage-failed');
      expect(failed.serving).toBe(false);
      // The row was written and then rolled back: the log is exactly what
      // everybody was last told, and the note is in nobody's board.
      expect(failed.logRows).toBe(before);

      // The next connection re-reads the last durable state - an empty board -
      // the room's own idea of the log is re-read with it, and from then on the
      // board works again.
      const c = await TestClient.connect(boardId);
      await c.waitForSync();
      expect(c.snapshot().length).toBe(0);
      createNotes(c, 2);
      const healed = await waitForStats(boardId, (s) => s.logRows >= before + 2, 'two rows');
      expect(healed.state).toBe('ready');
      expect(healed.updateCount).toBeLessThanOrEqual(healed.logRows);

      const d = await TestClient.connect(boardId);
      await d.waitForSync();
      expect(d.snapshot().length).toBe(2);
    },
    30000,
  );

  it(
    'connections hibernate: the room holds them through the Durable Object',
    async () => {
      const boardId = newBoardId();
      const a = await TestClient.connect(boardId);
      await a.waitForSync();

      // ctx.getWebSockets() only ever contains connections that were accepted
      // with ctx.acceptWebSocket(): a socket taken with server.accept() would
      // read as zero here, and a room that cached its own Set would be invisible.
      expect(await openSockets(boardId)).toBe(1);

      const b = await TestClient.connect(boardId);
      await b.waitForSync();
      expect(await openSockets(boardId)).toBe(2);

      a.close();
      await socketsDropped(boardId, 1);
    },
    30000,
  );

  it(
    'nothing a client sends that is not a durable change reaches storage',
    async () => {
      const boardId = newBoardId();
      const a = await TestClient.connect(boardId);
      await a.waitForSync();
      createNotes(a, 1);
      const b = await TestClient.connect(boardId);
      await b.waitForSync();
      const c = await TestClient.connect(boardId);
      await c.waitForSync();
      await tick(150); // let every handshake's own reply be appended first
      const before = await statsOf(boardId);
      expect(before.state).toBe('ready');

      // A text frame: that socket is closed, nothing is written.
      b.sendText('hello');
      expect(await b.waitForClose()).toBe(CLOSE_UNSUPPORTED_DATA);

      // Awareness is relayed to everyone and persisted by nobody.
      c.sendAwareness(new Uint8Array([0, 1, 2, 3]));
      await tick(150);

      const after = await statsOf(boardId);
      expect(after.logRows).toBe(before.logRows);
      expect(after.logBytes).toBe(before.logBytes);
      expect(after.quarantined).toBe(0);
      expect(after.state).toBe('ready');
      expect(c.open).toBe(true);
      expect(a.snapshot().length).toBe(1);
    },
    30000,
  );

  it(
    'the schema is created by the first read of a brand new board',
    async () => {
      const boardId = newBoardId();
      // Instantiating the room at all - no client, no HTTP - must bring the
      // schema up, because the load runs before any input is handled.
      const stats = await statsOf(boardId);
      expect(stats.state).toBe('ready');
      expect(stats.logRows).toBe(0);
      expect(stats.chunks).toBe(0);
      expect(await inRoom(boardId, (room) => room.testSchemaVersion())).toBe(String(STORAGE_SCHEMA_VERSION));
    },
    30000,
  );
});
