import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import type { StickySnapshot } from '../../src/shared/board-model';
import { boardsEqual, seedNotes as fixtureNotes } from '../fixtures/boards';
import {
  TestClient,
  clearAppendFault,
  clearReadFault,
  compactRoomNow,
  connectClient,
  connectClients,
  corruptSnapshot,
  forceMemoryEviction,
  notesInStorage,
  repairSnapshot,
  roomStub,
  runInDurableObject,
  settle,
  stubAppendOnce,
  stubReadFailureAndDrop,
  updateRowsInStorage,
  type RoomInternals,
} from './helpers/ws-client';

/**
 * `persist.room` (TC-12 to TC-18, TC-26): a board written by real editors is
 * found again by later ones, through real Durable Object SQLite and the real
 * room. The only injected things are the storage faults the design names — an
 * `append` that throws once (TC-14), a snapshot read that throws (TC-26) and a
 * snapshot damaged on disk (TC-15, TC-16) — because a test has no broken disk to
 * wait for. Everything else, including the eviction of the object's memory, is
 * the real thing.
 */

/** Sort two boards into the same order-free set and compare them. */
function sameNotes(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  return boardsEqual(a, b);
}

describe('TC-12: a change is in storage before anyone else is shown it', () => {
  it('a note is stored, relayed to B, and survives reading storage cold', async () => {
    const boardId = newBoardId();
    const [ada, bo] = await connectClients(boardId, ['Ada', 'Bo']);
    const id = ada.createNote({ x: 40, y: 60 });
    ada.setText(id, 'written to disk first');
    await ada.waitForText(id, 'written to disk first');
    await bo.waitForText(id, 'written to disk first');

    // the log row is there while the socket is still open, before it is closed
    expect(await updateRowsInStorage(boardId)).toBeGreaterThanOrEqual(1);

    const asSeen = ada.notes();
    ada.close();
    bo.close();

    // a document built straight from storage holds the note, text and all
    const fromDisk = await notesInStorage(boardId);
    expect(fromDisk).toHaveLength(1);
    expect(sameNotes(fromDisk, asSeen)).toBe(true);
    expect(fromDisk[0]!.id).toBe(id);
    expect(fromDisk[0]!.text).toBe('written to disk first');
  });
});


describe('TC-13: reopening a board after everyone has left finds it intact', () => {
  it('25 notes survive the memory being dropped and come back from storage', async () => {
    const boardId = newBoardId();
    const ada = await connectClient(boardId, 'Ada');
    fixtureNotes(ada.ydoc, 25, { seed: 20260714, multiLine: true });
    await settle(ada); // let every change reach the room before the board closes
    const expected = ada.notes();
    ada.close();

    // the object falls out of memory with its board still in SQLite
    await forceMemoryEviction(boardId);

    const sam = await connectClient(boardId, 'Sam');
    await sam.waitForNoteCount(25);
    expect(sameNotes(sam.notes(), expected)).toBe(true);
    sam.close();
  });
});

describe('TC-14: a change that cannot be saved is shown to no one, then retried', () => {
  it('a failing write closes both sockets, never shows the change, and a reconnect saves it', async () => {
    const boardId = newBoardId();
    const [ada, bo] = await connectClients(boardId, ['Ada', 'Bo']);
    await stubAppendOnce(boardId);

    const id = ada.createNote({ x: 5, y: 5 });

    // both are disconnected with the storage-failure code, and Bo is never
    // shown the change that could not be saved
    await ada.waitForClosed();
    await bo.waitForClosed();
    expect(ada.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(bo.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(bo.noteIds()).not.toContain(id);

    await clearAppendFault(boardId);

    // Ada still holds the change; on reconnect the room stores it and shows it
    await ada.reconnect();
    await settle(ada); // the room must have taken Ada's resend before we look
    expect((await notesInStorage(boardId)).map((n) => n.id)).toContain(id);

    await bo.reconnect();
    await bo.waitForNoteCount(1);
    expect(bo.noteIds()).toContain(id);
    ada.close();
    bo.close();
  });
});

describe('TC-15: a board whose snapshot is unreadable is closed, never served empty', () => {
  it('a damaged snapshot closes the newcomer with 4500 and stores nothing it sends', async () => {
    const boardId = newBoardId();
    const ada = await connectClient(boardId, 'Ada');
    fixtureNotes(ada.ydoc, 25, { seed: 71 });
    await settle(ada);
    ada.close();
    await compactRoomNow(boardId); // a snapshot now exists to damage
    await corruptSnapshot(boardId);

    const rowsBefore = await updateRowsInStorage(boardId);

    // Sam opens it, and is turned away rather than handed an empty board
    const sam = new TestClient(boardId, 'Sam');
    await sam.open();
    await sam.waitForClosed();
    expect(sam.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(sam.notes()).toHaveLength(0);

    // a sync the newcomer sent must not have been written into the log
    expect(await updateRowsInStorage(boardId)).toBe(rowsBefore);
  });
});

describe('TC-16: a damaged board that is repaired comes back on the next try', () => {
  it('closed at 4500 before the retry interval, then loads and syncs after a repair', async () => {
    const boardId = newBoardId();
    const ada = await connectClient(boardId, 'Ada');
    fixtureNotes(ada.ydoc, 25, { seed: 909 });
    await settle(ada);
    const expected = ada.notes();
    ada.close();
    await compactRoomNow(boardId);
    await corruptSnapshot(boardId);

    // first try, within the retry window: turned away, no reload attempted
    const first = new TestClient(boardId, 'First');
    await first.open();
    await first.waitForClosed();
    expect(first.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    // the storage is repaired, and the next connection reads the good board
    expect(await repairSnapshot(boardId)).toBe(true);
    const second = await connectClient(boardId, 'Second');
    await second.waitForNoteCount(25);
    expect(sameNotes(second.notes(), expected)).toBe(true);
    second.close();
  });
});

describe('TC-17: a garbage update is refused and never reaches storage', () => {
  it('an update that is not a Yjs update closes its socket and adds no log row', async () => {
    const boardId = newBoardId();
    const ada = await connectClient(boardId, 'Ada');
    const rowsBefore = await updateRowsInStorage(boardId);

    ada.sendGarbageSyncFrame();
    await ada.waitForClosed();

    expect(ada.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await updateRowsInStorage(boardId)).toBe(rowsBefore);
  });
});

describe('TC-18: a hibernated room still reaches the sockets it accepted', () => {
  it('after the room loses and rebuilds its memory, a change relays to the other editor', async () => {
    const boardId = newBoardId();
    const ada = await connectClient(boardId, 'Ada');
    const seed = ada.createNote({ x: 1, y: 1 });
    await ada.waitForText(seed, '');
    // Bo connects, then the room drops its in-memory document; both sockets are
    // the runtime's, so they must survive and keep relaying.
    const bo = await connectClient(boardId, 'Bo');
    await ada.waitForNoteCount(1);
    await bo.waitForNoteCount(1);

    // Ada makes a change the rebuilt room must still hand to Bo's socket
    const later = ada.createNote({ x: 2, y: 2 });
    await bo.waitForNoteCount(2);
    expect(bo.noteIds()).toContain(later);
    ada.close();
    bo.close();
  });
});

describe('TC-26: a read that fails is a load failure, never an empty board', () => {
  it('an unreadable snapshot read returns sql-error and closes newcomers with 4500', async () => {
    const boardId = newBoardId();
    const ada = await connectClient(boardId, 'Ada');
    fixtureNotes(ada.ydoc, 25, { seed: 31 });
    await settle(ada);
    ada.close();
    await compactRoomNow(boardId);

    // the store's snapshot read now throws; the room's document is dropped so
    // the next connection reloads straight into the failure
    await stubReadFailureAndDrop(boardId);

    const load = await runInDurableObject(roomStub(boardId), (object) => {
      const room = object as unknown as RoomInternals;
      return room.ydoc === null ? 'no-document' : 'has-document';
    });
    expect(load).toBe('no-document');

    const sam = new TestClient(boardId, 'Sam');
    await sam.open();
    await sam.waitForClosed();
    expect(sam.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(sam.notes()).toHaveLength(0);

    // with the fault removed the board reads back whole, proving it was the read
    await clearReadFault(boardId);
    const recovered = await connectClient(boardId, 'Recovered');
    await recovered.waitForNoteCount(25);
    expect(recovered.notes()).toHaveLength(25);
    recovered.close();
  });
});

