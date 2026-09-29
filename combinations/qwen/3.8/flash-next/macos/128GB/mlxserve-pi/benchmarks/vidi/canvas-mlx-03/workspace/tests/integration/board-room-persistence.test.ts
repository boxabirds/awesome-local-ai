/// <reference types="@cloudflare/vitest-pool-workers" />
// Integration tests for the persistent, hibernating BoardRoom (design
// "Persistent, hibernating board room"). Real Durable Object, real SQLite
// storage, real WebSockets speaking the y-websocket framing, real Y.Docs.
//
// What is injected, per the design's Mock-vs-real table, is only the *failure*:
// a BoardStore method is wrapped to throw once on the live object. Everything
// else — ordering of writes, transaction rollback, socket closing, state
// transitions — is the platform's own behaviour.
//
// One note on scope: inside one workerd instance an object is never evicted while
// a test holds it, so "the room forgot its document" is produced the way the room
// itself can forget one — the storage-write failure path, which discards the
// document and reloads from storage on the next connection. A real process
// restart is covered by the e2e suite (TC-19, TC-20).
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { newBoardId } from '../../src/shared/board-id.ts';
import {
  createSticky,
  getStickyText,
  type StickySnapshot,
} from '../../src/shared/board-model.ts';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config.ts';
import {
  MESSAGE_SYNC,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '../../src/shared/protocol.ts';
import { docFromUpdates, retroBoard, specsMatch, specsOf } from '../fixtures/boards.ts';
import type { BoardRoom } from '../../src/worker/board-room.ts';
import {
  RoomClient,
  connectClients,
  flush,
  snapshotsEqual,
  waitFor,
} from './helpers/ws-client.ts';
import {
  allClosed,
  closed,
  counts,
  corruptChunk,
  failAppends,
  failLoads,
  inRoom,
  loadAttempts,
  logSizes,
  repairChunk,
  restoreStore,
  roomState,
  seedSnapshot,
  storedBoard,
} from './helpers/room.ts';

/** A frame carrying a whole document as an unsolicited SyncStep2. */
function syncStep2Frame(doc: Y.Doc): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  encoding.writeVarUint(enc, syncProtocol.messageYjsSyncStep2);
  encoding.writeVarUint8Array(enc, Y.encodeStateAsUpdate(doc));
  return encoding.toUint8Array(enc);
}

function hasNote(notes: readonly StickySnapshot[], id: string): boolean {
  return notes.some((n) => n.id === id);
}

/** Jump the (mocked) clock past the room's load-retry interval. */
function afterRetryInterval(): void {
  vi.setSystemTime(new Date(Date.now() + LOAD_RETRY_MIN_INTERVAL_MS + 10));
}

/**
 * Put a room into `Snapshotted` storage holding `board`'s 25 notes, then make the
 * room forget its in-memory document so that its next connection has to read that
 * snapshot back. Returns the fixture and the room's first clients.
 */
async function roomWithSnapshot(boardId: string): Promise<{
  board: ReturnType<typeof retroBoard>;
  through: number;
}> {
  const board = retroBoard();
  const through = board.updates.length;
  const chunks = await seedSnapshot(boardId, docFromUpdates(board.updates), through);
  expect(chunks).toBeGreaterThanOrEqual(1);
  return { board, through };
}

/** Force the room to drop its document and reload, then damage the snapshot. */
async function dropDocumentAndDamageSnapshot(boardId: string): Promise<Uint8Array> {
  // A write failure makes the room close its sockets and discard the document —
  // the room's own documented reaction to storage that stops answering.
  await failAppends(boardId, 1);
  const c = await RoomClient.connect(boardId);
  createSticky(c.doc, { x: 0, y: 0 });
  expect(await closed(c)).toBe(CLOSE_STORAGE_FAILURE);
  await restoreStore(boardId, 'append');
  return corruptChunk(boardId);
}

describe('persist.room: a stored change is durable before it is seen', () => {
  it('TC-12: by the time another client can see an edit, its log row exists', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);

    const id = createSticky(a.doc, { x: 120, y: 40 });
    getStickyText(a.doc, id)?.insert(0, 'written once, read many');
    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'B sees the note');

    // The room stores before it broadcasts, so a reader that saw the note must
    // find the row already there — and SQLite alone holds it, not the room.
    const stored = await counts(boardId);
    expect(stored.updates).toBeGreaterThanOrEqual(1);
    const fromStorage = await storedBoard(boardId);
    expect(fromStorage.some((n) => n.id === id && n.text === 'written once, read many')).toBe(true);
    expect(specsMatch(fromStorage, a.snapshot())).toBe(true);
  });

  it('TC-13: after everyone leaves, the board that comes back is what storage holds', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);

    const ids = [createSticky(a.doc, { x: 0, y: 0 }), createSticky(a.doc, { x: 250, y: 0 })];
    expect(ids).toHaveLength(2);
    getStickyText(a.doc, ids[0]!)?.insert(0, 'first');
    getStickyText(a.doc, ids[1]!)?.insert(0, 'second');
    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'both see two notes');
    const agreed = specsOf(a.snapshot());

    // A third note never reaches storage: the write fails and the room throws its
    // document away, which is the only way this object can forget a board.
    await failAppends(boardId, 1);
    const unsaved = createSticky(a.doc, { x: 500, y: 0 });
    expect(await allClosed([a, b])).toEqual([CLOSE_STORAGE_FAILURE, CLOSE_STORAGE_FAILURE]);
    await restoreStore(boardId, 'append');

    const late = await RoomClient.connect(boardId);
    await waitFor(() => late.synced, 'late client syncs');

    // The reopened room serves exactly the stored board: both stored notes, and
    // nothing that only ever lived in the previous object's memory.
    expect(specsMatch(late.snapshot(), agreed)).toBe(true);
    expect(hasNote(late.snapshot(), unsaved)).toBe(false);
    expect(hasNote(await storedBoard(boardId), unsaved)).toBe(false);
    expect(await roomState(boardId)).toBe('ready');
  });
});

describe('persist.room: storage that stops answering', () => {
  it('TC-14: a failed write closes the room with 1011 and the change is saved on reconnect', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);

    const kept = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'first note synced');

    await failAppends(boardId, 1);
    const lost = createSticky(a.doc, { x: 400, y: 100 });

    // Both sockets are closed with 1011 and the unsaved change is not broadcast:
    // the output gate holds sends until the write is durable.
    expect(await allClosed([a, b])).toEqual([CLOSE_STORAGE_FAILURE, CLOSE_STORAGE_FAILURE]);
    expect(hasNote(b.snapshot(), lost)).toBe(false);
    expect(hasNote(await storedBoard(boardId), lost)).toBe(false);
    expect(await roomState(boardId)).toBe('storage-failed');

    // Storage recovers. A reconnects still holding the change, and the room —
    // rebuilt from storage — takes it back and hands it to B.
    await restoreStore(boardId, 'append');
    await a.reconnect();
    await b.reconnect();
    await waitFor(() => hasNote(b.snapshot(), lost), 'B receives the change after reconnect', 5000);
    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'clients converge');

    const stored = await storedBoard(boardId);
    expect(hasNote(stored, lost)).toBe(true);
    expect(hasNote(stored, kept)).toBe(true);
    expect(await roomState(boardId)).toBe('ready');
  });

  it('TC-17: an undecodable update is closed with 1003 and never written', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'note synced');
    const before = await counts(boardId);
    const sizes = await logSizes(boardId);

    b.sendRaw(new Uint8Array([9, 250, 251, 252, 253, 254, 255, 0, 1]));
    expect(await closed(b)).toBe(CLOSE_UNSUPPORTED_DATA);

    expect(hasNote(b.snapshot(), id)).toBe(true); // the good note is still there
    // Nothing was appended, and the board is untouched for everyone else.
    const after = await counts(boardId);
    expect(after.updates).toBe(before.updates);
    expect(await logSizes(boardId)).toEqual(sizes);
    expect(hasNote(await storedBoard(boardId), 'not-a-note-id')).toBe(false);
    expect(await roomState(boardId)).toBe('ready');
  });

  it('TC-26: a SQL read error on load closes clients with 4500 and deletes nothing', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);

    const id = createSticky(a.doc, { x: 0, y: 0 });
    getStickyText(a.doc, id)?.insert(0, 'board that cannot be read back');
    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'note synced');
    const before = await counts(boardId);

    // The room loses its document to a write failure, and the load that rebuilds
    // it fails too: the SELECT itself throws.
    await failLoads(boardId, 1);
    await failAppends(boardId, 1);
    createSticky(a.doc, { x: 600, y: 0 });
    expect(await allClosed([a, b])).toEqual([CLOSE_STORAGE_FAILURE, CLOSE_STORAGE_FAILURE]);

    const c = await RoomClient.connect(boardId);
    expect(await closed(c)).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await roomState(boardId)).toBe('load-failed');

    // A failing read is not a licence to delete: no row moved, none quarantined.
    const after = await counts(boardId);
    expect(after.updates).toBe(before.updates);
    expect(after.quarantined).toBe(0);

    // Once reads work again the board comes back whole, with no reload of the room.
    await restoreStore(boardId, 'load');
    await restoreStore(boardId, 'append');
    afterRetryInterval();
    const d = await RoomClient.connect(boardId);
    await waitFor(() => d.synced, 'board loads again');
    expect(d.snapshot().some((n) => n.id === id && n.text === 'board that cannot be read back')).toBe(true);
    expect(await roomState(boardId)).toBe('ready');
  });
});

describe('persist.room: a board that cannot be loaded', () => {
  /** Seed a snapshot, damage it, and force the room to read it. */
  async function brokenBoard(boardId: string): Promise<{
    board: ReturnType<typeof retroBoard>;
    original: Uint8Array;
  }> {
    await RoomClient.connect(boardId); // construct the room
    const { board } = await roomWithSnapshot(boardId);
    const original = await dropDocumentAndDamageSnapshot(boardId);
    return { board, original };
  }

  it('TC-15: a damaged snapshot closes the client with 4500 and stores nothing', async () => {
    const boardId = newBoardId();
    const { board } = await brokenBoard(boardId);
    const before = await counts(boardId);
    expect(before.chunks).toBeGreaterThanOrEqual(1);

    // A client that already holds an edit offers it immediately, before the
    // close reaches it.
    const client = await RoomClient.connect(boardId, {
      emptyDoc: true,
      prepopulate: (doc) => {
        createSticky(doc, { x: 0, y: 0 });
      },
    });
    client.sendRaw(syncStep2Frame(client.doc));

    expect(await closed(client)).toBe(CLOSE_BOARD_LOAD_FAILED);
    // No board was served — not even an empty one.
    expect(client.log).toHaveLength(0);
    // And nothing was written: the room does not touch storage for a board it
    // could not load.
    const after = await counts(boardId);
    expect(after.updates).toBe(before.updates);
    expect(after.quarantined).toBe(0);
    expect(after.chunks).toBe(before.chunks);
    expect(board.expected).toHaveLength(25);
  });

  it('TC-16: a retry before the interval is refused without loading; after it the board loads', async () => {
    const boardId = newBoardId();
    const { board, original } = await brokenBoard(boardId);

    const first = await RoomClient.connect(boardId);
    expect(await closed(first)).toBe(CLOSE_BOARD_LOAD_FAILED);
    const attempts = await loadAttempts(boardId);

    // Too soon: refused without touching storage again.
    const soon = await RoomClient.connect(boardId);
    expect(await closed(soon)).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await loadAttempts(boardId)).toBe(attempts);

    // The damage is repaired; the next connection after the interval loads.
    await repairChunk(boardId, original);
    afterRetryInterval();
    const late = await RoomClient.connect(boardId);
    await waitFor(() => late.synced, 'board loaded after the retry interval', 5000);

    expect(specsMatch(late.snapshot(), board.expected)).toBe(true);
    expect(await loadAttempts(boardId)).toBeGreaterThan(attempts);
    expect(await roomState(boardId)).toBe('ready');
  });
});

describe('persist.room: hibernation', () => {
  it('TC-18: sockets belong to the runtime, and relay keeps working across a document reload', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);

    // The room holds no socket list of its own; the runtime holds the accepted
    // sockets. That is what allows the object to go idle with clients attached.
    const listed = await inRoom(boardId, (room: BoardRoom) => room.openSockets);
    expect(listed).toBe(2);
    const own = await inRoom(boardId, (room: BoardRoom) => Object.getOwnPropertyNames(room));
    expect(own).not.toContain('sockets');

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'relay over runtime sockets');

    // The object forgets its document (write failure) and rebuilds it from
    // storage; the sockets it then relays through are still the runtime's.
    await failAppends(boardId, 1);
    createSticky(a.doc, { x: 800, y: 0 });
    expect(await allClosed([a, b])).toEqual([CLOSE_STORAGE_FAILURE, CLOSE_STORAGE_FAILURE]);
    await restoreStore(boardId, 'append');

    await a.reconnect();
    await b.reconnect();
    await waitFor(() => a.synced && b.synced, 'both reconnected');
    expect(await inRoom(boardId, (room: BoardRoom) => room.openSockets)).toBe(2);

    const second = createSticky(b.doc, { x: 0, y: 300 });
    await waitFor(() => hasNote(a.snapshot(), second), 'relay works after the reload');
    expect(hasNote(await storedBoard(boardId), second)).toBe(true);
    expect(hasNote(await storedBoard(boardId), id)).toBe(true);
    await flush();
  });
});
