/**
 * Integration tests for `persist.room` — story 4's TC-12 to TC-18 and TC-26.
 *
 * TC numbers here are story 4's, from its design document;
 * `board-room.test.ts` keeps story 3's numbering for the behaviour story 4 must
 * not break.
 *
 * Every failure injected here is a real storage failure — a `RAISE(ABORT)`
 * trigger, chunk bytes replaced with noise, a column that no longer exists —
 * never a switch inside `BoardRoom`. See NOTES.md.
 */

import { evictAllDurableObjects } from "cloudflare:test";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  createSticky,
  getStickyText,
  snapshot,
  type StickySnapshot,
} from "../../src/shared/board-model";
import {
  COMPACTION_UPDATE_COUNT,
  LOAD_RETRY_MIN_INTERVAL_MS,
  type StickyColor,
} from "../../src/shared/config";
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from "../../src/shared/protocol";
import type { BoardRoom } from "../../src/worker/board-room";
import { BoardStore, type LoadResult } from "../../src/worker/board-store";
import { retroBoard, seededEdits } from "../fixtures/boards";
import {
  connectBoard,
  expectConverged,
  inRoom,
  restartRoom,
  roomSnapshot,
  createTestBoard,
  type TestClient,
} from "./helpers/ws-client";

// ---- looking at the storage a room is running on -------------------------

function storageOf(room: BoardRoom): DurableObjectStorage {
  return (room as unknown as { ctx: DurableObjectState }).ctx.storage;
}

/** Creates a note and writes its text, the way the board editor does. */
function writeNote(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor,
  text: string,
): string {
  const id = createSticky(doc, at, color);
  if (typeof id !== "string") throw new Error("the note was not created");
  getStickyText(doc, id)?.insert(0, text);
  return id;
}

interface StorageFacts {
  updateRows: number;
  updateBytes: number;
  chunkRows: number;
  quarantinedRows: number;
  snapshotThroughSeq: number;
}

async function storageFacts(boardId: string): Promise<StorageFacts> {
  return inRoom(boardId, (room) => {
    const sql = storageOf(room).sql;
    const one = (query: string): number => Number(sql.exec(query).one()["n"] ?? 0);
    const cursor = sql.exec("SELECT value FROM storage_meta WHERE key = ?", "snapshot_through_seq");
    const row = cursor.next();
    const through = row === undefined || row.done === true ? null : row.value["value"];
    return {
      updateRows: one("SELECT COUNT(*) AS n FROM updates"),
      updateBytes: one("SELECT COALESCE(SUM(bytes), 0) AS n FROM updates"),
      chunkRows: one("SELECT COUNT(*) AS n FROM snapshot_chunks"),
      quarantinedRows: one("SELECT COUNT(*) AS n FROM quarantined_updates"),
      snapshotThroughSeq: through === null || through === undefined ? 0 : Number(through),
    };
  });
}

/** What a brand-new reader would reconstruct out of storage alone. */
async function storedBoard(
  boardId: string,
): Promise<{ result: LoadResult; notes: readonly StickySnapshot[] }> {
  return inRoom(boardId, (room) => {
    const store = new BoardStore(storageOf(room));
    const doc = new Y.Doc();
    const result = store.load(doc);
    return { result, notes: snapshot(doc) };
  });
}

interface RoomStateFacts {
  state: string;
  instanceId: string;
  hasDoc: boolean;
  loadFailedAtMs: number | null;
}

function roomStateFacts(boardId: string): Promise<RoomStateFacts> {
  return inRoom(boardId, (room) => ({
    state: room.state,
    instanceId: room.instanceId,
    hasDoc: room.doc !== null,
    loadFailedAtMs: room.loadFailedAtMs,
  }));
}

/** Runs `body` with an injected SQL failure in place, then removes it. */
async function withInjectedFailure<T>(
  boardId: string,
  trigger: string,
  body: () => Promise<T>,
): Promise<T> {
  await inRoom(boardId, (room) => {
    storageOf(room).sql.exec(trigger);
  });
  try {
    return await body();
  } finally {
    await inRoom(boardId, (room) => {
      storageOf(room).sql.exec("DROP TRIGGER IF EXISTS injected_failure");
    });
  }
}

/** Replaces a snapshot chunk's bytes with noise, returning what was there. */
async function corruptSnapshotChunk(boardId: string, index: number): Promise<Uint8Array> {
  return inRoom(boardId, (room) => {
    const sql = storageOf(room).sql;
    const row = sql.exec("SELECT data FROM snapshot_chunks WHERE idx = ?", index).next();
    if (row === undefined || row.done === true) throw new Error(`no snapshot chunk ${index}`);
    const original = new Uint8Array(row.value["data"] as ArrayBuffer);
    const damage = new Uint8Array(original.byteLength);
    for (let i = 0; i < damage.byteLength; i += 1) damage[i] = (i * 7 + 13) & 0xff;
    sql.exec("UPDATE snapshot_chunks SET data = ? WHERE idx = ?", damage.slice().buffer, index);
    return original;
  });
}

function restoreSnapshotChunk(boardId: string, index: number, bytes: Uint8Array): Promise<void> {
  return inRoom(boardId, (room) => {
    storageOf(room).sql.exec("UPDATE snapshot_chunks SET data = ? WHERE idx = ?", bytes.slice().buffer, index);
  });
}

/**
 * Writes board content from inside the room, one transaction per change, the way
 * a stream of clients would: each change goes through the room's own append path.
 * Used to push a log past the compaction threshold without 500 sockets.
 */
function fillLog(boardId: string, count: number): Promise<number> {
  return inRoom(boardId, (room) => {
    if (room.doc === null) throw new Error("room has no document to write through");
    for (let written = 0; written < count; written += 1) seededEdits(room.doc, 1, 20260902 + written);
    return room.store === null ? -1 : room.store.state().logRows;
  });
}

/** Creates `count` notes through a connected client, one transaction each. */
async function seedNotes(client: TestClient, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    client.transact((doc) =>
      writeNote(doc, { x: 40 + index * 30, y: 80 + (index % 5) * 40 }, "yellow", `kept note ${index}`),
    );
  }
  await client.waitForRoomNotes(count);
}

const byId = (notes: readonly StickySnapshot[]): StickySnapshot[] =>
  [...notes].sort((left, right) => (left.id < right.id ? -1 : 1));

// ---- TC-12: durable before it is visible ---------------------------------

describe("write path (TC-12, TC-14, TC-17)", () => {
  it("TC-12 an update is in storage before another client can have received it", async () => {
    const boardId = await createTestBoard();
    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);
    await a.waitForSync();
    await b.waitForSync();
    b.resetFrames();

    const id = a.transact((doc) => writeNote(doc, { x: 20, y: 30 }, "violet", "written first, then sent"));
    await b.waitForUpdates(1);

    // The row exists the moment B's copy exists, because the room writes the row
    // before it sends the frame: B could not have this frame without it.
    const facts = await storageFacts(boardId);
    expect(facts.updateRows).toBe(1);
    expect(facts.updateBytes).toBeGreaterThan(0);

    // And the row is a board, not a receipt: a fresh document built only from
    // storage holds the note.
    const stored = await storedBoard(boardId);
    expect(stored.result.ok).toBe(true);
    expect(byId(stored.notes).map((note) => note.id)).toEqual([id]);

    await expectConverged(boardId, [a, b]);

    // Every client disconnects. Closing a socket from the client side is not
    // something these tests wait for — only closes the room sends are observable
    // from here, which is why `waitForClose` appears in the failure tests only.
    expect((await storageFacts(boardId)).updateRows).toBe(1);
    expect(byId((await storedBoard(boardId)).notes).map((note) => note.text)).toEqual([
      "written first, then sent",
    ]);
  });

  it("TC-14 a change that could not be written is never broadcast, and is stored when the sender returns", async () => {
    const boardId = await createTestBoard();
    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);
    await a.waitForSync();
    await b.waitForSync();
    b.resetFrames();

    const before = await storageFacts(boardId);

    // `BEFORE INSERT ON updates` fails: `BoardStore.append` throws inside the
    // Yjs update handler, which is the same point a real write failure lands on.
    await withInjectedFailure(
      boardId,
      `CREATE TRIGGER injected_failure BEFORE INSERT ON updates
       BEGIN SELECT RAISE(ABORT, 'storage is full'); END`,
      async () => {
        a.transact((doc) => writeNote(doc, { x: 40, y: 40 }, "orange", "the unsaved change"));

        const [closedA, closedB] = await Promise.all([a.waitForClose(), b.waitForClose()]);
        expect(closedA.code).toBe(CLOSE_STORAGE_FAILURE);
        expect(closedB.code).toBe(CLOSE_STORAGE_FAILURE);
      },
    );

    // Nothing reached the other client, and nothing reached storage.
    expect(b.updatesOf("the unsaved change")).toBe(0);
    expect((await storageFacts(boardId)).updateRows).toBe(before.updateRows);
    expect((await roomStateFacts(boardId)).state).toBe("storage-failed");

    // The sender still holds the change. On its way back in, the room has
    // reloaded from storage, and the change goes through the normal path.
    await b.reconnect();
    await b.waitForSync();
    b.resetFrames();

    await a.reconnect();
    await a.waitForSync();

    await b.waitForUpdates(1);
    expect(b.notes.some((note) => note.text === "the unsaved change")).toBe(true);

    const stored = await storedBoard(boardId);
    expect(stored.result.ok).toBe(true);
    expect(stored.notes.some((note) => note.text === "the unsaved change")).toBe(true);
    expect((await storageFacts(boardId)).updateRows).toBe(before.updateRows + 1);

    await expectConverged(boardId, [a, b]);
    a.close();
    b.close();
  });

  it("TC-17 garbage that is rejected is not stored", async () => {
    const boardId = await createTestBoard();
    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);
    await a.waitForSync();
    await b.waitForSync();

    const before = await storageFacts(boardId);

    // Framed as a sync message, with an update inside that Yjs cannot read.
    const body = encoding.createEncoder();
    syncProtocol.writeUpdate(body, new Uint8Array([255, 255, 255, 255]));
    a.sendRaw(encoding.toUint8Array(body));

    const closed = await a.waitForClose();
    expect(closed.code).toBe(CLOSE_UNSUPPORTED_DATA);

    const after = await storageFacts(boardId);
    expect(after.updateRows).toBe(before.updateRows);
    expect(after.updateBytes).toBe(before.updateBytes);
    expect(after.quarantinedRows).toBe(0);

    // The room is still a room: the other client keeps working, and its work is
    // stored like any other.
    expect((await roomStateFacts(boardId)).state).toBe("ready");
    b.transact((doc) => writeNote(doc, { x: 10, y: 10 }, "blue", "still working"));
    await b.waitForRoomNotes(1);
    expect((await storageFacts(boardId)).updateRows).toBe(before.updateRows + 1);

    a.close();
    b.close();
  });
});

// ---- TC-13: coming back to the same board --------------------------------

describe("reload path (TC-13)", () => {
  it("TC-13 a new room instance over the same storage gives the same board", async () => {
    const boardId = await createTestBoard();
    const fixture = retroBoard(25);

    const a = await connectBoard(boardId);
    await a.waitForSync();
    for (const update of fixture.updates) Y.applyUpdate(a.requireDoc(), update);
    await a.waitForRoomNotes(25);

    // Log only: nothing has been compacted, so the reload reads the log — one
    // row per fixture update (the first one is the document's schema stamp).
    expect((await storageFacts(boardId)).chunkRows).toBe(0);
    expect((await storageFacts(boardId)).updateRows).toBe(fixture.updates.length);

    a.close();
    await restartRoom(boardId);

    const b = await connectBoard(boardId);
    await b.waitForSync();
    expect(byId(b.notes)).toEqual(byId(fixture.notes));

    // Not just equal to the fixture: equal to what the room had before it died.
    expect(JSON.stringify(byId(b.notes))).toBe(JSON.stringify(byId((await storedBoard(boardId)).notes)));
    expect(await roomSnapshot(boardId)).not.toBeNull();
    expect(byId((await roomSnapshot(boardId)) ?? [])).toEqual(byId(fixture.notes));

    b.close();
  });
});

// ---- TC-15, TC-16, TC-26: a board that could not be loaded ---------------

describe("load failure (TC-15, TC-16, TC-26)", () => {
  /** 25 notes, compacted into a snapshot, with the log emptied behind it. */
  const snapshottedBoard = async (): Promise<string> => {
    const boardId = await createTestBoard();
    const a = await connectBoard(boardId);
    await a.waitForSync();
    await seedNotes(a, 25);
    await fillLog(boardId, COMPACTION_UPDATE_COUNT - 25);
    await a.waitForRoomNotes(25);

    const facts = await storageFacts(boardId);
    expect(facts.chunkRows).toBeGreaterThanOrEqual(1);
    expect(facts.updateRows).toBeLessThan(COMPACTION_UPDATE_COUNT);

    a.close();
    return boardId;
  };

  it("TC-15 a damaged snapshot closes the connection with 4500 and stores nothing", async () => {
    const boardId = await snapshottedBoard();
    await corruptSnapshotChunk(boardId, 0);
    await restartRoom(boardId);

    const before = await storageFacts(boardId);
    const client = await connectBoard(boardId);

    // The client keeps talking before it notices the close; none of it is stored.
    try {
      client.transact((doc) => writeNote(doc, { x: 5, y: 5 }, "blue", "arrived at a closed door"));
      client.sendSyncStep1();
    } catch {
      // The socket was already closed by the room. That is the other half of the
      // assertion: nothing after the close either.
    }

    const closed = await client.waitForClose();
    expect(closed.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    const after = await storageFacts(boardId);
    expect(after.updateRows).toBe(before.updateRows);
    expect(after.updateBytes).toBe(before.updateBytes);
    expect(after.quarantinedRows).toBe(0);

    // The room holds no document: a newcomer is not served an empty board.
    expect((await roomStateFacts(boardId)).hasDoc).toBe(false);
    expect((await roomSnapshot(boardId))).toBeNull();
    expect((await storedBoard(boardId)).result.ok).toBe(false);
  });

  it("TC-16 a failed load is tried again only after the retry interval", async () => {
    const boardId = await snapshottedBoard();
    const expected = byId((await storedBoard(boardId)).notes);
    expect(expected.length).toBe(25);

    const original = await corruptSnapshotChunk(boardId, 0);
    await restartRoom(boardId);

    const first = await connectBoard(boardId);
    expect((await first.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Storage is fine again, but the room is not going to hammer it.
    await restoreSnapshotChunk(boardId, 0, original);

    const second = await connectBoard(boardId);
    expect((await second.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);
    const refused = await roomStateFacts(boardId);
    expect(refused.state).toBe("load-failed");
    expect(refused.hasDoc).toBe(false);

    // Time passes — which is the only thing the room was waiting for.
    await inRoom(boardId, (room) => {
      if (room.loadFailedAtMs !== null) room.loadFailedAtMs -= LOAD_RETRY_MIN_INTERVAL_MS;
    });

    const third = await connectBoard(boardId);
    await third.waitForSync();
    expect(byId(third.notes)).toEqual(expected);
    expect((await roomStateFacts(boardId)).state).toBe("ready");
    expect((await roomStateFacts(boardId)).hasDoc).toBe(true);

    third.close();
  });

  it("TC-26 a query that fails is a failed load, not an empty board", async () => {
    const boardId = await createTestBoard();
    const a = await connectBoard(boardId);
    await a.waitForSync();
    await seedNotes(a, 25);
    a.close();

    // A real read failure: the column the log query selects is gone, and
    // `migrate()` will not bring it back because the table itself is there.
    await inRoom(boardId, (room) => {
      storageOf(room).sql.exec("ALTER TABLE updates DROP COLUMN bytes");
    });

    const loaded = await storedBoard(boardId);
    expect(loaded.result.ok).toBe(false);
    expect(loaded.result).toMatchObject({ reason: "sql-error" });

    await restartRoom(boardId);
    const client = await connectBoard(boardId);
    expect((await client.waitForClose()).code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect((await roomStateFacts(boardId)).hasDoc).toBe(false);

    client.close();
  });
});

// ---- TC-18: the hibernation path -----------------------------------------

describe("hibernation (TC-18)", () => {
  it("TC-18 a broadcast reaches sockets accepted before the room was reconstructed", async () => {
    const boardId = await createTestBoard();
    const fixture = retroBoard(25);

    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);
    await a.waitForSync();
    await b.waitForSync();
    for (const update of fixture.updates) Y.applyUpdate(a.requireDoc(), update);
    await b.waitForUpdates(fixture.updates.length);
    await expectConverged(boardId, [a, b]);

    // The instance goes away while the sockets stay open: workerd keeps the
    // sockets and replays the next message onto a brand-new instance, which has
    // to load the board before it can answer.
    await evictAllDurableObjects();
    expect(a.isClosed).toBe(false);
    expect(b.isClosed).toBe(false);

    const rowsBefore = (await storageFacts(boardId)).updateRows;
    b.resetFrames();

    const id = a.transact((doc) => writeNote(doc, { x: 900, y: 900 }, "pink", "sent to a room that had gone away"));
    await b.waitForUpdates(1);

    expect(b.notes.some((note) => note.id === id)).toBe(true);
    expect(a.updatesOf("had gone away")).toBe(0);

    const facts = await storageFacts(boardId);
    expect(facts.updateRows).toBe(rowsBefore + 1);

    // The reconstructed room holds the loaded board plus the new change, and the
    // new change is in storage too.
    const stored = await storedBoard(boardId);
    expect(stored.notes.some((note) => note.id === id)).toBe(true);
    expect(byId(stored.notes).length).toBe(26);

    await expectConverged(boardId, [a, b]);
    a.close();
    b.close();
  });
});
