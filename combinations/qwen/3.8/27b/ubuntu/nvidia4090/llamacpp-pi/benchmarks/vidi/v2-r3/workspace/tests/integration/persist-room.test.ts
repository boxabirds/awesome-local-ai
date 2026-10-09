import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import { writeUpdate } from 'y-protocols/sync';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';
import { buildRetroBoard } from '../fixtures/boards';
import { createBoard, hooks } from './hooks';
import { boardUrl, RoomClient, sameNotes, waitUntil } from './ws-client';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Story 4, task 5: the persistent room end to end — durability, storage
 * failures, load failures and the hibernation-safe socket path, driven
 * against a real workerd worker + Durable Object.
 */
describe('BoardRoom persistence (TC-12..TC-18, TC-26)', () => {
  it('TC-12: a broadcast update is already in storage; a fresh load from storage contains it', async () => {
    const board = await createBoard();
    const A = await RoomClient.connect(boardUrl(board));
    const B = await RoomClient.connect(boardUrl(board));
    await A.waitForSync();
    await B.waitForSync();

    A.doc.transact(() => {
      const id = createSticky(A.doc, { x: 1, y: 2 }, 'pink');
      getStickyText(A.doc, id)?.insert(0, 'persisted');
    });
    await waitUntil(() => B.notes().some((n) => n.text === 'persisted'));

    // write-before-broadcast: by the time B observed the note, the append
    // had already committed, so the log holds it
    const status = await hooks.status(board);
    expect(status.updates.count).toBeGreaterThanOrEqual(1);

    // and a brand-new doc loaded from storage sees the note
    const { result, notes } = await hooks.load(board);
    expect(result.ok).toBe(true);
    expect(notes.some((n) => n.text === 'persisted')).toBe(true);
    A.close();
    B.close();
  });

  it('TC-13: everyone leaves; a rebuilt room over the same storage serves the identical board', async () => {
    const board = await createBoard();
    const A = await RoomClient.connect(boardUrl(board));
    const B = await RoomClient.connect(boardUrl(board));
    await A.waitForSync();
    await B.waitForSync();

    for (let i = 0; i < 5; i++) {
      A.doc.transact(() => {
        const id = createSticky(A.doc, { x: i, y: i * 2 }, 'yellow');
        getStickyText(A.doc, id)?.insert(0, `note ${i}`);
      });
    }
    await waitUntil(() => B.notes().length === 5);
    const original = B.notes();

    A.close();
    B.close();
    await A.waitForClose();
    await B.waitForClose();

    // simulate the instance dying (storage untouched) and a fresh
    // instance being created for the next connection
    await hooks.roomReset(board);
    const C = await RoomClient.connect(boardUrl(board));
    await C.waitForSync();
    await waitUntil(() => C.notes().length === 5);
    expect(sameNotes(C.notes(), original)).toBe(true);
    C.close();
  });

  it('TC-14: an append failure closes everyone 1011 without broadcasting; the change survives reconnect', async () => {
    const board = await createBoard();
    const A = await RoomClient.connect(boardUrl(board));
    const B = await RoomClient.connect(boardUrl(board));
    await A.waitForSync();
    await B.waitForSync();

    await hooks.roomInject(board, { append: 'once' });
    A.doc.transact(() => {
      const id = createSticky(A.doc, { x: 9, y: 9 }, 'blue');
      getStickyText(A.doc, id)?.insert(0, 'survivor');
    });

    const closeA = await A.waitForClose();
    const closeB = await B.waitForClose();
    expect(closeA.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(closeB.code).toBe(CLOSE_STORAGE_FAILURE);
    // the failed update was never broadcast
    expect(B.notes().some((n) => n.text === 'survivor')).toBe(false);

    // A reconnects still holding the change (its local doc is unchanged)
    const A2 = await RoomClient.connect(boardUrl(board));
    await A2.waitForSync();
    Y.applyUpdate(A2.doc, Y.encodeStateAsUpdate(A.doc), 'reconnect');

    const B2 = await RoomClient.connect(boardUrl(board));
    await B2.waitForSync();
    await waitUntil(() => B2.notes().some((n) => n.text === 'survivor'));
    // the change is stored this time
    expect((await hooks.status(board)).updates.count).toBeGreaterThanOrEqual(1);
    A2.close();
    B2.close();
  });

  it('TC-15: a corrupted snapshot closes clients 4500; sync traffic sent before the close stores nothing', async () => {
    // Story 5: this board is seeded through storage hooks and is never
    // created via the API — it exercises the legacy existence rule.
    const board = newBoardId();
    const fixture = buildRetroBoard();
    await hooks.appendMany(board, fixture.perNoteUpdates);
    expect((await hooks.compact(board, { force: true })).compacted).toBe(true);
    await hooks.corruptSnapshot(board); // damages chunk 0 and resets the room

    const A = await RoomClient.connect(boardUrl(board));
    const close = await A.waitForClose();
    expect(close.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    const status = await hooks.status(board);
    expect(status.updates.count).toBe(0); // nothing was appended
    expect(status.chunks).toBe(1); // the snapshot was left in place
  });

  it('TC-16: no load retry before LOAD_RETRY_MIN_INTERVAL_MS; after it the repaired board loads', async () => {
    const board = newBoardId();
    const fixture = buildRetroBoard();
    await hooks.appendMany(board, fixture.perNoteUpdates);
    expect((await hooks.compact(board, { force: true })).compacted).toBe(true);
    await hooks.corruptSnapshot(board);

    const t0 = Date.now();
    const A = await RoomClient.connect(boardUrl(board));
    expect((await A.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // still inside the retry interval
    const B = await RoomClient.connect(boardUrl(board));
    expect((await B.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // storage is healthy again, but the room must not have retried yet
    await hooks.repairSnapshot(board);
    const C = await RoomClient.connect(boardUrl(board));
    expect((await C.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // after the interval a connection triggers a fresh load
    const elapsed = Date.now() - t0;
    if (elapsed < LOAD_RETRY_MIN_INTERVAL_MS + 1000) {
      await sleep(LOAD_RETRY_MIN_INTERVAL_MS + 1000 - elapsed);
    }
    const D = await RoomClient.connect(boardUrl(board));
    await waitUntil(() => D.notes().length === 25, 15_000);
    expect(sameNotes(D.notes(), fixture.notes)).toBe(true);
    D.close();
  }, 30_000);

  it('TC-17: a garbage Yjs update closes the sender 1003 and stores nothing', async () => {
    const board = await createBoard();
    const A = await RoomClient.connect(boardUrl(board));
    const B = await RoomClient.connect(boardUrl(board));
    await A.waitForSync();
    await B.waitForSync();

    // a tail-truncated real update: guaranteed to fail Yjs decoding
    // (a head slice would decode as a valid empty update)
    const fixture = buildRetroBoard();
    const u = fixture.perNoteUpdates[0];
    const garbage = u.slice(0, u.length - 10);
    const enc = encoding.createEncoder();
    writeUpdate(enc, garbage);
    A.sendSyncPayload(encoding.toUint8Array(enc));

    const close = await A.waitForClose();
    expect(close.code).toBe(CLOSE_UNSUPPORTED_DATA);
    expect((await hooks.status(board)).updates.count).toBe(0);

    // the room is still healthy for the other clients
    const C = await RoomClient.connect(boardUrl(board));
    await C.waitForSync();
    C.doc.transact(() => {
      getStickyText(C.doc, createSticky(C.doc, { x: 0, y: 0 }, 'green'))?.insert(0, 'fine');
    });
    await waitUntil(() => B.notes().some((n) => n.text === 'fine'));
    C.close();
    B.close();
  });

  it('TC-18: after the room is rebuilt, sockets accepted earlier still receive broadcasts', async () => {
    const board = await createBoard();
    const A = await RoomClient.connect(boardUrl(board));
    await A.waitForSync(); // A's socket is accepted; the room is ready

    // simulate a hibernate/wake rebuild: the in-memory doc is discarded,
    // accepted sockets stay in ctx.getWebSockets()
    await hooks.roomReset(board);
    const B = await RoomClient.connect(boardUrl(board)); // triggers the reload
    await B.waitForSync();

    B.doc.transact(() => {
      getStickyText(B.doc, createSticky(B.doc, { x: 3, y: 4 }, 'green'))?.insert(0, 'after wake');
    });
    // A's socket was accepted before the rebuild and must still be reached
    await waitUntil(() => A.notes().some((n) => n.text === 'after wake'));
    A.close();
    B.close();
  });

  it('TC-26: a SQL failure in load closes connecting clients with 4500', async () => {
    const board = await createBoard();
    const A = await RoomClient.connect(boardUrl(board));
    await A.waitForSync();
    A.close();
    await A.waitForClose();

    // the next load() throws (the SELECT path) and the room is forced to reload
    await hooks.roomInject(board, { load: 'once', reset: true });
    const B = await RoomClient.connect(boardUrl(board));
    const close = await B.waitForClose();
    expect(close.code).toBe(CLOSE_BOARD_LOAD_FAILED);
  });
});
