/**
 * persist.room, against a real `wrangler dev` server (see `helpers/live-server.ts`)
 * with real WebSockets, a real Durable Object and real SQLite: what makes a board
 * survive being left.
 *
 * The difference from `board-room.test.ts` (story 3) is where the truth is looked
 * for. Here almost every case ends at the board's *storage*, through the test-only
 * `/__test/boards/:id/...` routes (`helpers/hooks.ts`): "B received it" is not the
 * same statement as "it was written", and "the board is broken" must never look
 * like an empty board.
 *
 * TC-12 stored before it is seen · TC-13 the board outlives everyone leaving ·
 * TC-14 a failed write reaches nobody and is written on the retry ·
 * TC-15 an unreadable snapshot turns people away instead of showing an empty board ·
 * TC-16 a broken board retries at a sane rate and recovers when it is repaired ·
 * TC-17 garbage is refused without writing anything · TC-26 a read that throws
 * closes clients with the load-failure code rather than inventing a board.
 *
 * TC-16's exact retry rate, and the room's half of the hibernation arrangement
 * (TC-18), are in `tests/integration/room-hibernation.test.ts`: `wrangler dev` puts
 * a socketless room away and moves its clock by more than the retry interval while
 * it does, so how many times a broken board was read cannot be counted here. What
 * is counted here is what a person joining a broken board experiences.
 *
 * Each case uses its own random board id, so no case can see another's room.
 */

import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';

import { createSticky, getStickyText, moveObject, setStickyColor } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { retroBoard } from '../fixtures/boards';
import { hooks } from './helpers/hooks';
import { closeWait, sleep, untilAsync } from './helpers/util';
import {
  allConverged,
  RoomClient,
  SYNC_UPDATE,
  snapshotsEqual,
  until,
  type RoomClientOptions,
} from './helpers/ws-client';

const open: RoomClient[] = [];

async function join(boardId: string, options: RoomClientOptions = {}): Promise<RoomClient> {
  const client = await RoomClient.connectSynced(boardId, options);
  open.push(client);
  return client;
}

/**
 * How many changes this board's log holds. Deliberately nothing else: a room that
 * is put away and woken again reports its own clock too, and `wrangler dev` moves
 * that clock when it evicts, so anything measured in time is compared in
 * `room-hibernation.test.ts`, where the clock behaves.
 */
async function boardStats(boardId: string): Promise<{ updates: number }> {
  const status = await hooks.status(boardId);
  return { updates: status.storage.updateCount };
}

async function storedNotes(boardId: string) {
  return (await hooks.storedBoard(boardId)).notes;
}

/** One note, with text, in a single transaction — one change to store. */
function newNote(client: RoomClient, x: number, text: string): string {
  let id = '';
  client.doc.transact(() => {
    id = createSticky(client.doc, { x, y: 0 }, 'pink');
    getStickyText(client.doc, id)?.insert(0, text);
  });
  return id;
}

/** Build a real 25-note retro board and wait until all of it is on disk. */
async function buildRetroBoard(client: RoomClient, boardId: string): Promise<void> {
  retroBoard(client.doc);
  await until(() => client.boardSnapshot().length >= 25, 'retro board to build');
  await untilAsync(async () => (await boardStats(boardId)).updates > 0, 'changes to be stored');
}

/** One update frame carrying `update`, as a client would send it. */
function updateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeVarUint(encoder, SYNC_UPDATE);
  encoding.writeUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

/**
 * Send it if the socket is still open. A room that refuses people may have closed
 * this one first, and either way the point is what the board ended up holding.
 */
function pushIfOpen(client: RoomClient, bytes: Uint8Array): void {
  try {
    client.sendRaw(bytes);
  } catch {
    /* Already closed by the room. */
  }
}

afterEach(() => {
  for (const client of open.splice(0)) client.dispose();
});

describe('board room persistence', () => {
  it('TC-12: by the time another client sees a change, it is in storage', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);

    // Several kinds of change at once, so "stored" is not proven for creation alone.
    const id = createSticky(a.doc, { x: -40, y: 90 }, 'green');
    const yText = getStickyText(a.doc, id);
    if (!yText) throw new Error('the note has no text');
    yText.insert(0, 'decisions from the retro');
    setStickyColor(a.doc, id, 'violet');
    moveObject(a.doc, id, 220, -130);

    await until(() => snapshotsEqual(a.boardSnapshot(), b.boardSnapshot()), 'change to reach B');

    // No pause first: the write happened before the broadcast, so there is no
    // moment in which B has seen something the board does not hold.
    expect((await boardStats(boardId)).updates).toBeGreaterThan(0);
    const stored = await storedNotes(boardId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      text: 'decisions from the retro',
      color: 'violet',
      x: 220,
      y: -130,
    });
  });

  it('TC-13: the board is there when everyone comes back, after the room is gone', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    retroBoard(a.doc);
    await until(() => allConverged([a, b]) && a.boardSnapshot().length >= 25, 'retro board to merge');
    const before = a.boardSnapshot();

    // Everyone leaves...
    a.close(1000);
    b.close(1000);
    await until(() => a.isOffline && b.isOffline, 'both sockets to close');

    // ...and then the object itself is torn down abruptly, so nothing of what it
    // held in memory survives. A brand new instance reads the board from storage.
    await hooks.abort(boardId);

    const back = await join(boardId);
    expect(snapshotsEqual(back.boardSnapshot(), before)).toBe(true);

    // And it is a working room, not a museum: a change made here is broadcast and
    // stored like any other.
    const late = await join(boardId);
    const id = newNote(back, 0, 'written after the room came back');
    await until(() => late.boardSnapshot().some((note) => note.id === id), 'change in the new room to arrive');
    expect((await storedNotes(boardId)).some((note) => note.id === id)).toBe(true);
  });

  it('TC-14: a board whose write fails shows the change to nobody, and writes it on the next attempt', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    newNote(a, 0, 'kept from before');
    await until(() => b.boardSnapshot().length === 1, 'first note to reach B');

    // Both are about to be closed, so both baselines are taken before the action.
    const aCloses = a.closes.length;
    const bCloses = b.closes.length;

    // The next write to this board's storage will fail.
    await hooks.failAppend(boardId);
    const lost = newNote(a, 500, 'the change that could not be written');

    // Both are closed with the storage-failure code, and B never saw the change:
    // nobody is shown something the board could not keep.
    expect(await closeWait(a, aCloses)).toBe(CLOSE_STORAGE_FAILURE);
    expect(await closeWait(b, bCloses)).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.boardSnapshot().some((note) => note.id === lost)).toBe(false);
    expect((await storedNotes(boardId)).some((note) => note.id === lost)).toBe(false);

    // Both come back. A still holds its change — its screen did not lose it — and a
    // room that has read the board again asks joiners for what they have, so the
    // change is written this time and reaches B.
    await a.reconnect();
    await b.reconnect();
    await until(() => b.boardSnapshot().some((note) => note.id === lost), 'the retry to reach B');
    expect((await storedNotes(boardId)).some((note) => note.id === lost)).toBe(true);
    expect(snapshotsEqual(a.boardSnapshot(), b.boardSnapshot())).toBe(true);
  });

  it('TC-15: a board whose snapshot cannot be read turns people away rather than opening empty', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    await buildRetroBoard(a, boardId);

    // Fold the board into a snapshot, then damage that snapshot in storage.
    await hooks.compact(boardId);
    expect((await hooks.status(boardId)).storage.snapshotChunks).toBeGreaterThan(0);
    await hooks.corruptSnapshot(boardId);

    // The room reads the board again and finds it unreadable.
    await hooks.reload(boardId);
    expect((await hooks.status(boardId)).state).toBe('load-failed');

    const before = await boardStats(boardId);
    const b = await RoomClient.connect(boardId);
    open.push(b);
    // A change of its own, offered to a room that has not read the board — and a
    // room that has not read the board does not write to it.
    const unsent = newNote(b, 0, 'sent to a room that could not load');
    pushIfOpen(b, updateFrame(Y.encodeStateAsUpdate(b.doc)));
    expect(await closeWait(b, 0)).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await boardStats(boardId)).toEqual(before);
    expect((await storedNotes(boardId)).some((note) => note.id === unsent)).toBe(false);
    // Nobody was handed an empty board to work on.
    expect(b.isSynced).toBe(false);
  });

  it('TC-18: the runtime answers for a connection, and a rebuilt room counts only live ones', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    await buildRetroBoard(a, boardId);

    // The keepalive the runtime answers on the room's behalf — `acceptWebSocket`
    // plus `setWebSocketAutoResponse`, which is what allows a connection to be held
    // while the object that accepted it is not running. It is a text frame, so it is
    // nothing in the board's protocol: the room has no code for it and should not
    // need any, and it must not be mistaken for a broken message and closed.
    const textFramesBefore = a.frames.filter((frame) => frame.type === -1).length;
    a.sendRaw('PING');
    await until(
      () =>
        a.frames.some(
          (frame) => frame.type === -1 && new TextDecoder().decode(frame.payload) === 'PONG',
        ),
      'the runtime keepalive answer',
    );
    expect(a.ws?.readyState).toBe(WebSocket.OPEN);
    // Nothing else arrived: the answer came from the runtime, not from the board.
    expect(a.frames.filter((frame) => frame.type === -1).length).toBe(textFramesBefore + 1);

    // The room is then thrown away mid-conversation — the abrupt kind, not a reload.
    await hooks.abort(boardId);
    await sleep(400);
    const b = await join(boardId);
    expect(b.boardSnapshot().length).toBe(25);

    // What the rebuilt room counts as its audience is what the runtime reports, so
    // the halt left nothing behind: A's socket went with the room that was aborted,
    // and B is the one connection there is. A room holding a list of its own would
    // have had a stale entry in it, and would have been sending to nobody.
    const status = await hooks.status(boardId);
    expect({ state: status.state, sockets: status.sockets }).toEqual({
      state: 'ready',
      sockets: 1,
    });
    expect(a.ws?.readyState).toBe(WebSocket.CLOSED);

    // And the rebuilt room broadcasts: a note made by B reaches C, which joined it
    // afterwards, and is on storage by then too.
    const c = await join(boardId);
    const written = 'written after the room was thrown away';
    newNote(b, 600, written);
    await until(
      () => c.boardSnapshot().some((note) => note.text === written),
      'a note across the rebuilt room',
    );
    await untilAsync(
      async () => (await storedNotes(boardId)).some((note) => note.text === written),
      'that note on storage',
    );
  });

  it('TC-16: a broken board retries no more than once per LOAD_RETRY_MIN_INTERVAL_MS, and recovers when repaired', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    await buildRetroBoard(a, boardId);
    await hooks.compact(boardId);
    await hooks.corruptSnapshot(boardId);
    await hooks.reload(boardId);

    // The room says the board is broken instead of opening an empty one, and it is
    // not going to look at it again straight away.
    const failed = await hooks.status(boardId);
    expect(failed.state).toBe('load-failed');
    expect(failed.retryDue).toBe(false);

    // Joiners are turned away, one after another, and none of them is met with a
    // board quietly rebuilt from whatever could be read. How many times the board
    // was read while this was going on is counted in `room-hibernation.test.ts`.
    for (let attempt = 0; attempt < 3; attempt++) {
      const client = await RoomClient.connect(boardId);
      open.push(client);
      expect(await closeWait(client, 0)).toBe(CLOSE_BOARD_LOAD_FAILED);
      expect(client.isSynced).toBe(false);
    }

    // Repaired, but the retry is not immediate: what is being waited for is the
    // interval, not the repair, so an eager client cannot turn recovery into a loop.
    await hooks.repairSnapshot(boardId);
    const impatient = await RoomClient.connect(boardId);
    open.push(impatient);
    expect(await closeWait(impatient, 0)).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Past the interval, the next joiner is met with the board — all 25 notes of it.
    await sleep(LOAD_RETRY_MIN_INTERVAL_MS + 100);
    const back = await join(boardId);
    const ready = await hooks.status(boardId);
    expect(ready.state).toBe('ready');
    // A board that reads fine carries no failure forward.
    expect(ready.loadFailedAt).toBeNull();
    expect(back.boardSnapshot().length).toBeGreaterThanOrEqual(25);
  });

  it('TC-17: a garbage frame is refused with 1003 and nothing is written', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    newNote(a, 0, 'a note that is fine');
    await until(() => b.boardSnapshot().length === 1, 'note to reach B');

    const before = await boardStats(boardId);
    a.sendRaw(new Uint8Array([0, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(await closeWait(a, a.closes.length)).toBe(CLOSE_UNSUPPORTED_DATA);

    // Refused at the door: the log did not grow, and everyone else is unaffected.
    expect(await boardStats(boardId)).toEqual(before);
    expect(b.closes).toEqual([]);
    expect(b.boardSnapshot()).toHaveLength(1);
  });

  it('TC-26: a board whose storage read throws closes clients with 4500 instead of inventing a board', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    newNote(a, 0, 'kept on disk');
    await until(() => b.boardSnapshot().length === 1, 'note to reach B');
    await untilAsync(async () => (await boardStats(boardId)).updates > 0, 'note to be stored');

    // Now make reading fail, and make the room read again.
    const aCloses = a.closes.length;
    const bCloses = b.closes.length;
    await hooks.failLoad(boardId);
    await hooks.reload(boardId);

    // Both people are told the board could not be loaded — not dropped quietly, and
    // not left looking at a board that is no longer there.
    expect(await closeWait(a, aCloses)).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await closeWait(b, bCloses)).toBe(CLOSE_BOARD_LOAD_FAILED);

    const status = await hooks.status(boardId);
    expect(status.state).toBe('load-failed');
    expect(status.lastLoadError).not.toBe('');

    // The board is not presented as empty: its note is still in storage, and the
    // room refuses to serve anything it has not read.
    expect((await storedNotes(boardId)).map((note) => note.text)).toEqual(['kept on disk']);

    // A newcomer is refused too. Once the retry is due, the note is still there — it
    // was never lost, only unreadable for a moment.
    const stranger = await RoomClient.connect(boardId);
    open.push(stranger);
    expect(await closeWait(stranger, 0)).toBe(CLOSE_BOARD_LOAD_FAILED);

    await sleep(LOAD_RETRY_MIN_INTERVAL_MS + 100);
    const back = await join(boardId);
    expect(back.boardSnapshot().map((note) => note.text)).toEqual(['kept on disk']);
  });

});
