/**
 * The room that keeps its board (persist.room, persist.save_failure).
 *
 * Story 3 asked what a room does with the people in it. These cases ask what it
 * does with the board when the people are gone — and, because the answers are
 * only real if the room is the product's own object, they run against a real
 * Durable Object with real SQLite, over real websockets, with the product's
 * `BoardStore` underneath and nothing faked in between.
 *
 * Three things are checked over and over, because they are the three ways a
 * stored board goes wrong: what storage holds *now* (not after a restart, which
 * is how you catch a room that spoke before it wrote), what a fresh read of it
 * gives back, and what a failure did *not* change.
 */
import {
  abortAllDurableObjects,
  env,
  evictDurableObject,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import * as Y from "yjs";

import type { StickySnapshot } from "../../src/shared/board-model";
import { newBoardId } from "../../src/shared/board-id";
import {
  COMPACTION_UPDATE_COUNT,
  LOAD_RETRY_MIN_INTERVAL_MS,
} from "../../src/shared/config";
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from "../../src/shared/protocol";
import { BoardStore } from "../../src/worker/board-store";
import type { LoadResult } from "../../src/worker/board-store";

import { notesOf, retroBoard, truncatedUpdate } from "../fixtures/boards";

import { blob, breakSql, countRows, watchSql } from "./broken-storage";
import type { WatchedSql } from "./broken-storage";
import { applyAndLog, foldTheLog } from "./seed";
import {
  BoardClient,
  closed,
  createNote,
  delay,
  initializeBoard,
  moveNote,
  recolourNote,
  roomHolds,
  roomSockets,
  settle,
  synced,
  typeInNote,
  waitFor,
} from "./ws-client";

/** This board's room object. `get` does not start it; a connection does. */
const roomOf = (boardId: string) =>
  env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

/**
 * Ask one board's storage a question from outside. This wakes the room if it is
 * asleep — which is fine: it is the same object the clients are talking to, and
 * it is the only way to ask storage while a board is in use.
 */
function peek<T>(
  boardId: string,
  ask: (storage: DurableObjectStorage) => T,
): Promise<T> {
  return runInDurableObject(roomOf(boardId), (_room, state) =>
    ask(state.storage),
  );
}

/** What a room would get if it read this board right now, and what it is made of. */
interface StoredBoard {
  readonly load: LoadResult;
  readonly notes: readonly StickySnapshot[];
  readonly rows: number;
  readonly chunks: number;
  readonly quarantined: number;
}

function storedBoard(boardId: string): Promise<StoredBoard> {
  return peek(boardId, (storage) => {
    const store = new BoardStore(storage);
    const doc = new Y.Doc();
    const load = store.load(doc);
    return {
      load,
      notes: notesOf(doc),
      rows: countRows(storage, "updates"),
      chunks: countRows(storage, "snapshot_chunks"),
      quarantined: countRows(storage, "quarantined_updates"),
    };
  });
}

const idsOf = (notes: readonly StickySnapshot[]): string[] =>
  notes.map((note) => note.id);

/** Sorted the way `notesOf` sorts, so a client's board and storage's can be compared whole. */
const sorted = (notes: readonly StickySnapshot[]): readonly StickySnapshot[] =>
  [...notes].sort((left, right) => (left.id < right.id ? -1 : 1));

/** Two clients of one board, both caught up with it and with each other. */
async function pair(): Promise<{
  boardId: string;
  a: BoardClient;
  b: BoardClient;
}> {
  // Story 5: connecting no longer makes a board, so these cases ask for one
  // first — the same RPC `POST /api/boards` makes.
  const boardId = newBoardId();
  await initializeBoard(boardId);
  const a = await BoardClient.join(boardId);
  await synced(a);
  const b = await BoardClient.join(boardId);
  await synced(b);
  await roomHolds(boardId, 2);
  return { boardId, a, b };
}

/**
 * A board of `count` notes made the way a board is made — through the model,
 * over a socket, seen by a second client — plus what the two clients agreed on.
 */
async function drawnBoard(count: number): Promise<{
  boardId: string;
  a: BoardClient;
  b: BoardClient;
  before: readonly StickySnapshot[];
}> {
  const { boardId, a, b } = await pair();
  for (let index = 0; index < count; index += 1) {
    const id = createNote(a, {
      x: (index % 5) * 320,
      y: Math.floor(index / 5) * 240,
    });
    // A note somebody typed into and recoloured: text and colour travel in
    // their own updates, and a board that survives only its creates is a
    // quarter of a board.
    typeInNote(a, id, `retro item ${index}`);
    if (index % 3 === 0) recolourNote(a, id, "violet");
    if (index % 7 === 0)
      moveNote(a, id, (index % 5) * 320 + 12, Math.floor(index / 5) * 240 + 12);
  }
  await waitFor(
    "the second client has every note",
    () => b.notes().length === count,
  );
  await settle(a);
  await settle(b);
  const before = b.notes();
  expect(a.notes()).toEqual(before);
  return { boardId, a, b, before };
}

/**
 * Stand a board in the stored state that has the most to lose: a snapshot, no
 * log (the coverage table's D1). `retroBoard` is 25 notes; the log is grown to
 * the compaction threshold with real typing edits and folded, and then the
 * snapshot's first chunk is cut to a quarter of itself, which is the shape of
 * row a read comes back with.
 */
async function snapshotBoardWithDamagedChunk(): Promise<{
  boardId: string;
  /** The snapshot's first chunk, as it was before it was broken. */
  intact: Uint8Array;
  notes: readonly StickySnapshot[];
}> {
  const boardId = newBoardId();
  const seeded = await peek(boardId, (storage) => {
    const store = new BoardStore(storage);
    store.migrate();
    const built = retroBoard();
    const doc = applyAndLog(store, built.updates);
    // A 25-note board does not reach the compaction threshold on its own, so
    // the log is grown the way a real one grows: people typing.
    foldTheLog(store, storage, doc, COMPACTION_UPDATE_COUNT);
    const stored = storage.sql
      .exec("SELECT data FROM snapshot_chunks WHERE idx = 0")
      .one().data as ArrayBuffer;
    const intact = new Uint8Array(stored.slice(0));
    const short = new Uint8Array(
      Math.max(8, Math.floor(intact.byteLength / 4)),
    );
    short.set(intact.slice(0, short.byteLength));
    storage.sql.exec(
      "UPDATE snapshot_chunks SET data = ?, bytes = ? WHERE idx = 0",
      blob(short),
      short.byteLength,
    );
    // The damage has to be damage: the board has to be unreadable *now*, before
    // any client is involved, or the tests below prove nothing.
    const unreadable = new BoardStore(storage).load(new Y.Doc());
    return { intact, notes: notesOf(doc), unreadable };
  });
  expect(seeded.unreadable.ok).toBe(false);
  // The room this seeding woke up holds the board in memory, and a room with a
  // board in memory answers from it. Throwing the room away is what makes the
  // next connection a first connection.
  await abortAllDurableObjects();
  return { boardId, ...seeded };
}

/**
 * Collect what a room wrote to `console.error` while an await was in flight.
 * The object runs in the same isolate as the test, so its own log line is
 * observable with nothing in front of it — and "the room said this out loud" is
 * one of the two things a failure test can check from outside.
 */
function captureErrors(sink: (line: string) => void): () => void {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    sink(args.map((arg) => String(arg)).join(" "));
  };
  return () => {
    console.error = original;
  };
}

describe("an update is stored before it is broadcast (TC-12)", () => {
  it("has the row in storage by the time the other client has the note", async () => {
    const { boardId, a, b } = await pair();
    // A board nobody has drawn on holds one row per client that has synced, and
    // not one more. Each client's `initDoc` schema is a real transaction by that
    // client, so it is a real row; the room's own copy of the schema is created
    // with `LOCAL_ORIGIN` and must not be logged — three rows here would mean it
    // had been, and TC-25's "an undrawn board has nothing in it" would be a lie
    // one level up.
    const before = await storedBoard(boardId);
    expect(before.rows).toBe(2);
    expect(before.load.ok).toBe(true);

    const updatesBefore = b.received.updates;
    const id = createNote(a, { x: 40, y: 24 });
    await waitFor("the other client has the note", () =>
      b.notes().some((note) => note.id === id),
    );
    const delivered = b.received.updates - updatesBefore;

    // Nothing was slept on or settled before asking storage: the room writes an
    // update's bytes before it relays them, so the only way this passes is if the
    // write came first.
    const after = await storedBoard(boardId);
    // One row for one change — not one per client, and not one per Yjs internal.
    expect(after.rows).toBe(before.rows + 1);
    expect(delivered).toBe(1);
    expect(after.load.ok).toBe(true);
    // Not just its id: position, colour and text, the whole note, compared with
    // what the clients are holding.
    expect(after.notes).toEqual(sorted(b.notes()));
    expect(after.notes).toEqual(sorted(a.notes()));

    a.leave();
    b.leave();
  });

  it("gives a newcomer the change from storage instead of making somebody retype it", async () => {
    const { boardId, a, b } = await pair();
    const id = createNote(a, { x: 10, y: 10 });
    await waitFor("the other client has the note", () =>
      b.notes().some((note) => note.id === id),
    );

    const before = await storedBoard(boardId);
    const late = await BoardClient.join(boardId);
    await synced(late);
    expect(sorted(late.notes())).toEqual(sorted(b.notes()));
    // The note reached the newcomer in the answer to the question it asked on
    // arrival (a SyncStep2), not as somebody else retyping it.
    expect(late.received.step2).toBeGreaterThanOrEqual(1);
    // The one row the newcomer added is its own schema. The note is still one
    // row: reading a board and teaching it are different things.
    const after = await storedBoard(boardId);
    expect(after.rows).toBe(before.rows + 1);
    expect(after.notes).toEqual(before.notes);

    late.leave();
    a.leave();
    b.leave();
  });
});

describe("everybody leaves, the room is thrown away, the board is back (TC-13)", () => {
  it("comes back through a new room instance with the same 25 notes", async () => {
    const { boardId, a, b, before } = await drawnBoard(25);
    expect(before).toHaveLength(25);

    a.leave();
    b.leave();
    await roomHolds(boardId, 0);

    // A deploy, an eviction, a restart: this is the abrupt kind, where the room
    // gets no chance to say goodbye — which is exactly why it cannot be depended
    // on to have written anything on the way out.
    await abortAllDurableObjects();

    // The first client of the new instance is an ordinary newcomer.
    const back = await BoardClient.join(boardId);
    await synced(back);
    expect(back.notes()).toEqual(before);

    // And it is not a copy only one client can make: a second client joins the
    // new room, and the two of them still agree, note for note, character for
    // character.
    const second = await BoardClient.join(boardId);
    await synced(second);
    expect(second.notes()).toEqual(before);
    const typed = before.find((note) => note.text.startsWith("retro item "));
    expect(typed).toBeDefined();
    expect(second.notes()).toContainEqual(typed);

    // Storage agrees with the clients, which is the difference between a board
    // that survived and two clients that happened to match.
    const after = await storedBoard(boardId);
    expect(after.notes).toEqual(sorted(before));
    // Creates, texts, colours and moves: more rows than notes.
    expect(after.rows).toBeGreaterThan(25);

    // The new room is a room: changes still reach everybody, and are stored.
    const added = createNote(back, { x: 900, y: 900 });
    await waitFor("the other client sees the new note", () =>
      second.notes().some((note) => note.id === added),
    );
    expect(idsOf((await storedBoard(boardId)).notes)).toContain(added);

    second.leave();
    back.leave();
  });
});

describe("the room could not write (TC-14, persist.save_failure)", () => {
  it("loses the change in public, and the client gives it back", async () => {
    const { boardId, a, b } = await pair();
    const kept = createNote(a, { x: 10, y: 10 });
    await waitFor(
      "both clients have the first note",
      () => b.notes().length === 1,
    );
    const rowsBefore = (await storedBoard(boardId)).rows;
    const updatesAtB = b.received.updates;

    // The first insert the room makes from here fails, once. That is what a
    // write that does not land looks like: one bad answer, everything after it
    // normal again — and the room must not sit on a change it could not write.
    let healed = () => {};
    await peek(boardId, (storage) => {
      healed = breakSql(
        storage,
        (sql) => sql.startsWith("INSERT INTO updates"),
        "simulated: the row was refused",
        1,
      );
    });

    const lost = createNote(a, { x: 20, y: 20 });
    let logs: string[] = [];
    const restoreLog = captureErrors((line) => logs.push(line));
    try {
      await Promise.all([closed(a), closed(b)]);
    } finally {
      restoreLog();
      healed();
    }
    expect(a.close?.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.close?.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.close?.reason).toBe("board storage failure");
    expect(
      logs.some((line) => line.includes("simulated: the row was refused")),
    ).toBe(true);

    // The change never reached the other client: nobody is looking at a board
    // storage does not have.
    expect(b.received.updates).toBe(updatesAtB);
    expect(idsOf(b.notes())).toEqual([kept]);
    // Nothing was written, and the room is not holding a board storage does not
    // have — it has no board at all.
    const during = await storedBoard(boardId);
    expect(during.rows).toBe(rowsBefore);
    expect(idsOf(during.notes)).toEqual([kept]);
    await roomHolds(boardId, 0);

    // The client that made the change still has it: its page says "reconnecting",
    // it comes back, and the room — which reloads from storage instead of
    // trusting what it had — is told everything the client holds.
    const backA = await BoardClient.join(boardId, a.doc);
    await synced(backA);
    expect(idsOf(backA.notes())).toContain(lost);
    const afterRetry = await storedBoard(boardId);
    expect(afterRetry.rows).toBe(rowsBefore + 1);
    expect(idsOf(afterRetry.notes)).toContain(lost);

    // The client that never saw it catches up, and the two are live again.
    const backB = await BoardClient.join(boardId, b.doc);
    await synced(backB);
    await waitFor("the other client gets the note it had missed", () =>
      backB.notes().some((note) => note.id === lost),
    );
    await settle(backB);
    expect(backB.notes()).toEqual(backA.notes());

    // One room, one socket list, and the next change is written as if nothing
    // had happened.
    expect(await roomSockets(boardId)).toBe(2);
    const next = createNote(backA, { x: 30, y: 30 });
    await waitFor("the other client sees it", () =>
      backB.notes().some((note) => note.id === next),
    );
    expect(idsOf((await storedBoard(boardId)).notes)).toContain(next);

    backA.leave();
    backB.leave();
  });
});

describe("the board could not be read (TC-15, TC-16)", () => {
  it("refuses a board whose snapshot is damaged, and changes nothing about it", async () => {
    const { boardId, intact, notes } = await snapshotBoardWithDamagedChunk();
    expect(idsOf(notes)).toHaveLength(25);

    const client = await BoardClient.join(boardId);
    // y-websocket has the client ask for the board before it says anything, and
    // a client that was open when the room died would send its own state as
    // well: none of that may be written into a board nobody can read.
    try {
      client.sendUpdate(Y.encodeStateAsUpdate(client.doc));
    } catch {
      // Refused before it could say anything — in which case there was nothing
      // it could have stored either.
    }
    const close = await closed(client, 3_000);
    expect(close.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    client.leave();

    // `Snapshotted, damaged` is the state the design says must not be loaded
    // partially: the snapshot is the whole board, and there is no way to know
    // which notes were in it. So the board is refused whole, nothing is
    // quarantined (a snapshot chunk is not a logged change), nothing is deleted,
    // and nothing the client sent was written.
    const after = await storedBoard(boardId);
    expect(after.load).toMatchObject({
      ok: false,
      reason: "snapshot-unreadable",
    });
    expect(after.chunks).toBe(1);
    expect(after.rows).toBe(0);
    expect(after.quarantined).toBe(0);
    // Still the short row it was: the room did not "repair" anything.
    const bytes = await peek(boardId, (storage) =>
      Number(
        storage.sql
          .exec("SELECT bytes FROM snapshot_chunks WHERE idx = 0")
          .one().bytes,
      ),
    );
    expect(bytes).toBeLessThan(intact.byteLength);
  });

  it("waits before reading again, and reads again once it has waited", async () => {
    const { boardId, intact } = await snapshotBoardWithDamagedChunk();

    const first = await BoardClient.join(boardId);
    expect((await closed(first, 3_000)).code).toBe(CLOSE_BOARD_LOAD_FAILED);
    first.leave();
    const failedAt = Date.now();

    // Count the statements from here, so "it did not read the board again" is a
    // measurement and not a reading of the source.
    //
    // "A read" means a read of *the board*. Story 5 added a question every
    // connection asks first — is there a board at this address at all? — which
    // reads `sqlite_master` and three `LIMIT 1` probes and nothing else; the
    // store labels those statements, so they can be told apart from a read of the
    // log and the snapshot, which is what this interval is about (TC-16).
    const boardReads = (sql: string): boolean =>
      /^\s*SELECT/.test(sql) && !sql.includes("board: exists?");
    let watched: WatchedSql | undefined;
    await peek(boardId, (storage) => {
      watched = watchSql(storage);
    });
    if (!watched) throw new Error("the statements were never counted");

    // Clients reconnecting in a loop must not turn one unreadable board into a
    // read loop, so a connection inside the interval is refused *without*
    // reading.
    const impatient = await BoardClient.join(boardId);
    expect((await closed(impatient, 3_000)).code).toBe(CLOSE_BOARD_LOAD_FAILED);
    impatient.leave();
    expect(watched.seen.filter(boardReads)).toEqual([]);
    expect(Date.now() - failedAt).toBeLessThan(LOAD_RETRY_MIN_INTERVAL_MS);

    // Storage is fixed and the board is readable again — but the room still has
    // to wait the interval out before it says so.
    await peek(boardId, (storage) => {
      storage.sql.exec(
        "UPDATE snapshot_chunks SET data = ?, bytes = ? WHERE idx = 0",
        blob(intact),
        intact.byteLength,
      );
    });
    await delay(
      Math.max(0, LOAD_RETRY_MIN_INTERVAL_MS - (Date.now() - failedAt)) + 100,
    );

    const patient = await BoardClient.join(boardId);
    await synced(patient);
    expect(patient.notes()).toHaveLength(25);
    expect(patient.close).toBeUndefined();
    const reads = watched.seen.filter(boardReads);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.join(" ")).toContain("FROM updates");

    // A room that reads again is a room again: its next change is stored, and it
    // took it from a client it was not sure about.
    const witness = await BoardClient.join(boardId);
    await synced(witness);
    const added = createNote(patient, { x: 10, y: 10 });
    await waitFor("the other client sees it", () =>
      witness.notes().some((note) => note.id === added),
    );
    expect(idsOf((await storedBoard(boardId)).notes)).toContain(added);

    witness.leave();
    patient.leave();
    // The statement counter comes off: the rest of the suite is not interested
    // in what this board was asked.
    await peek(boardId, () => watched?.restore());
  });
});

describe("an update that cannot be applied is not stored (TC-17)", () => {
  const badUpdates = [
    {
      name: "bytes that are not a Yjs update",
      send: (client: BoardClient) =>
        client.sendRaw(Uint8Array.from([0, 2, 7, 1, 2, 3, 4, 5, 6, 7, 8, 9])),
    },
    {
      // The same damage a stored log row can have (TC-09, TC-10): a real update
      // with its end missing, arriving from the other direction.
      name: "a truncated Yjs update",
      send: (client: BoardClient) => {
        const built = retroBoard(6);
        client.sendUpdate(truncatedUpdate(built.updates[3], 12));
      },
    },
    {
      // Well-framed and undecodable at the same time: the length in front of it
      // promises more bytes than the frame has.
      name: "an update whose length lies",
      send: (client: BoardClient) =>
        client.sendUpdate(Uint8Array.from([200, 1, 2])),
    },
  ];

  for (const bad of badUpdates) {
    it(`${bad.name}: the sender is dropped and storage is untouched`, async () => {
      const { boardId, a, b } = await pair();
      const kept = createNote(a, { x: 10, y: 10 });
      await waitFor(
        "the other client has the note",
        () => b.notes().length === 1,
      );
      const before = await storedBoard(boardId);

      bad.send(a);
      expect((await closed(a, 3_000)).code).toBe(CLOSE_UNSUPPORTED_DATA);

      // Nothing was stored, and nothing was quarantined either: quarantine is
      // for rows the room read out of its own log, not for garbage a client
      // sent. The rest of the room is unaffected.
      const after = await storedBoard(boardId);
      expect(after.rows).toBe(before.rows);
      expect(after.quarantined).toBe(0);
      expect(after.notes).toEqual(before.notes);
      expect(b.open).toBe(true);
      expect(idsOf(b.notes())).toEqual([kept]);

      // The room is still serving: a newcomer is told about the note that is
      // there, and its own change is written.
      const joiner = await BoardClient.join(boardId);
      await synced(joiner);
      expect(idsOf(joiner.notes())).toEqual([kept]);
      const fresh = createNote(joiner, { x: 20, y: 20 });
      await waitFor(
        "the surviving client sees it",
        () => b.notes().length === 2,
      );
      expect(idsOf((await storedBoard(boardId)).notes)).toContain(fresh);

      joiner.leave();
      a.leave();
      b.leave();
    });
  }
});

describe("the room is reconstructed and the sockets are still there (TC-18)", () => {
  it("broadcasts through ctx.getWebSockets() to clients accepted earlier", async () => {
    const { boardId, a, b } = await pair();
    const kept = createNote(a, { x: 10, y: 10 });
    await waitFor("both clients have the note", () => b.notes().length === 1);
    const rowsAfterFirst = (await storedBoard(boardId)).rows;

    // Both sockets are idle, which is what lets the runtime put the object away
    // while the websockets stay open: nothing about either end may live in a
    // closure of the object that is going away.
    await settle(a);
    await settle(b);
    await evictDurableObject(roomOf(boardId));
    expect(a.open).toBe(true);
    expect(b.open).toBe(true);

    // The next frame wakes the room: a new instance, which read the board from
    // storage in its constructor and is now handed the frames of two sockets it
    // did not accept.
    const added = createNote(a, { x: 40, y: 40 });
    await waitFor("the other client hears it", () => b.notes().length === 2);
    await settle(b);

    // The reconstructed room's socket list is the runtime's, so both ends are in
    // it, and it is what carried the change.
    expect(await roomSockets(boardId)).toBe(2);
    expect(sorted(b.notes())).toEqual(sorted(a.notes()));
    expect(idsOf(b.notes()).sort()).toEqual([kept, added].sort());
    const after = await storedBoard(boardId);
    expect(idsOf(after.notes).sort()).toEqual([kept, added].sort());
    expect(after.rows).toBe(rowsAfterFirst + 1);
    // And still one set of bytes per change: the room did not store the board it
    // had just read back.
    expect(b.received.updates).toBe(2);

    a.leave();
    b.leave();
  });
});

describe("a board that cannot be read at all (TC-26, persist.save_failure)", () => {
  it("says what kind of failure it is, and refuses the board", async () => {
    const { boardId, a } = await pair();
    const kept = createNote(a, { x: 10, y: 10 });
    await waitFor("the note is on the client", () => a.notes().length === 1);
    const rowsBefore = (await storedBoard(boardId)).rows;

    // Every statement the object makes fails — the injected store of the design,
    // injected into the object's own storage instead of around it.
    let healed = () => {};
    await peek(boardId, (storage) => {
      healed = breakSql(storage, () => true, "simulated: the disk is gone");
    });
    createNote(a, { x: 20, y: 20 });
    expect((await closed(a, 3_000)).code).toBe(CLOSE_STORAGE_FAILURE);

    // A reconnect now means a reload, and the reload cannot even create its
    // tables. The room has to be able to say *which kind* of storage failure this
    // is: "storage error" is not a thing a client can act on, and this one means
    // "do not retry every second".
    let logs: string[] = [];
    const restoreLog = captureErrors((line) => logs.push(line));
    let direct: LoadResult | undefined;
    let retry: BoardClient | undefined;
    try {
      retry = await BoardClient.join(boardId, a.doc);
      const refused = await closed(retry, 3_000);
      // Asked directly, the same storage says the same thing, in the same words.
      direct = await peek(boardId, (storage) =>
        new BoardStore(storage).load(new Y.Doc()),
      );
      expect(refused.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    } finally {
      restoreLog();
      healed();
    }
    expect(
      logs.filter((line) => line.includes("simulated: the disk is gone"))
        .length,
    ).toBeGreaterThanOrEqual(1);
    expect(direct).toMatchObject({ ok: false, reason: "sql-error" });
    // What the room refused is a board, not a client: the note that was written
    // before the disk went is still in there, unreadable as it is at this
    // moment, and it is not quarantined, deleted, or folded into anything.
    const rows = await peek(boardId, (storage) => ({
      updates: countRows(storage, "updates"),
      quarantined: countRows(storage, "quarantined_updates"),
      chunks: countRows(storage, "snapshot_chunks"),
    }));
    expect(rows).toEqual({ updates: rowsBefore, quarantined: 0, chunks: 0 });
    // And once storage answers again it is the same single note: the failure
    // cost the board nothing it had already accepted.
    const readable = await storedBoard(boardId);
    expect(readable.load.ok).toBe(true);
    expect(idsOf(readable.notes)).toEqual([kept]);
    retry?.leave();
    a.leave();
  });
});
