/**
 * Integration tests for `sync.room` — TC-07 to TC-18, TC-31.
 *
 * Real Durable Object, real WebSockets, real Yjs documents: the assertions are
 * made on the documents the two (or six) peers end up with, and on the frames
 * each socket actually received.
 */

import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import { describe, expect, it } from "vitest";
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from "../../src/shared/board-model";
import { MAX_CONCURRENT_EDITORS, type StickyColor } from "../../src/shared/config";
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from "../../src/shared/protocol";
import { randomOp, seededRandom } from "./helpers/random-ops";
import {
  connectBoard,
  expectConverged,
  inRoom,
  restartRoom,
  roomDocEquals,
  roomSnapshot,
  sleep,
  testBoardId,
  waitUntil,
  waitUntilAsync,
  type TestClient,
} from "./helpers/ws-client";

interface Pair {
  boardId: string;
  a: TestClient;
  b: TestClient;
}

/** Two synced clients on a fresh board, with frame logs cleared. */
async function twoClients(): Promise<Pair> {
  const boardId = testBoardId();
  const a = await connectBoard(boardId);
  const b = await connectBoard(boardId);
  await Promise.all([a.waitForSync(), b.waitForSync()]);
  a.resetFrames();
  b.resetFrames();
  return { boardId, a, b };
}

/** A note both clients already agree on; created by `a`. */
async function sharedNote(pair: Pair, at = { x: 0, y: 0 }, color: StickyColor = "yellow", text = ""): Promise<string> {
  const id = pair.a.transact((doc) => createSticky(doc, at, color));
  if (typeof id !== "string") throw new Error("fixture note was not created");
  if (text) pair.a.transact((doc) => getStickyText(doc, id)?.insert(0, text));
  await pair.b.waitForUpdates(text ? 2 : 1);
  pair.a.resetFrames();
  pair.b.resetFrames();
  return id;
}

function textOf(client: TestClient, id: string): string {
  return client.notes.find((note) => note.id === id)?.text ?? "";
}

/** The JSON inside a y-websocket awareness body (`varuint8array`). */
function awarenessJson(body: Uint8Array): string {
  return new TextDecoder().decode(decoding.readVarUint8Array(decoding.createDecoder(body)));
}

// ---- one writer, one listener --------------------------------------------

describe("update propagation", () => {
  it("TC-07 a created note reaches the other client as exactly one update", async () => {
    const { boardId, a, b } = await twoClients();

    const id = a.transact((doc) => createSticky(doc, { x: 140, y: 60 }, "yellow"));
    expect(typeof id).toBe("string");

    await b.waitForUpdates(1);
    expect(b.updateCount).toBe(1);
    expect(JSON.stringify(b.notes)).toBe(JSON.stringify(a.notes));
    expect(b.notes[0]?.id).toBe(id);
    expect(await roomDocEquals(boardId, a.requireDoc())).toBe(true);

    a.close();
    b.close();
  });

  const mutations: { name: string; apply: (doc: Y.Doc, id: string) => void; check: (notes: readonly StickySnapshot[]) => boolean }[] = [
    {
      name: "move",
      apply: (doc, id) => expect(moveObject(doc, id, 420, -110)).toBe(true),
      check: (notes) => notes.length === 1 && notes[0]!.x === 420 && notes[0]!.y === -110,
    },
    {
      name: "recolour",
      apply: (doc, id) => expect(setStickyColor(doc, id, "pink")).toBe(true),
      check: (notes) => notes.length === 1 && notes[0]!.color === "pink",
    },
    {
      name: "text insert",
      apply: (doc, id) => getStickyText(doc, id)?.insert(getStickyText(doc, id)!.toString().length, " typed"),
      check: (notes) => notes.length === 1 && notes[0]!.text === "hello typed",
    },
    {
      name: "delete",
      apply: (doc, id) => expect(deleteObject(doc, id)).toBe(true),
      check: (notes) => notes.length === 0,
    },
  ];

  for (const mutation of mutations) {
    it(`TC-08 ${mutation.name} reaches the other client and is never echoed`, async () => {
      const { boardId, a, b } = await twoClients();
      const id = await sharedNote({ boardId, a, b }, { x: 20, y: 20 }, "yellow", "hello");

      a.transact((doc) => mutation.apply(doc, id));

      await b.waitForUpdates(1);
      // The sender never sees its own change come back.
      expect(a.updateCount).toBe(0);
      expect(a.isClosed).toBe(false);
      expect(mutation.check(a.notes)).toBe(true);
      expect(mutation.check(b.notes)).toBe(true);
      expect(JSON.stringify(b.notes)).toBe(JSON.stringify(a.notes));
      await expectConverged(boardId, [a, b]);

      a.close();
      b.close();
    });
  }
});

// ---- concurrent writers --------------------------------------------------

describe("merging", () => {
  it("TC-09 concurrent inserts into one note keep both", async () => {
    const { boardId, a, b } = await twoClients();
    const id = await sharedNote({ boardId, a, b }, { x: 0, y: 0 }, "yellow", "green");

    // Neither side has seen the other's change yet when it writes.
    a.transact((doc) => getStickyText(doc, id)?.insert(0, "red "));
    b.transact((doc) => getStickyText(doc, id)?.insert(textOf(b, id).length, " blue"));

    await expectConverged(boardId, [a, b]);
    expect(textOf(a, id)).toBe("red green blue");
    expect(textOf(b, id)).toBe("red green blue");

    a.close();
    b.close();
  });

  it("TC-10 concurrent writes to one property settle on the same value", async () => {
    const { boardId, a, b } = await twoClients();
    const id = await sharedNote({ boardId, a, b }, { x: 0, y: 0 });

    a.transact((doc) => moveObject(doc, id, 100, 50));
    b.transact((doc) => moveObject(doc, id, 300, 50));

    const notes = await expectConverged(boardId, [a, b]);
    expect(a.notes[0]?.x).toBe(b.notes[0]?.x);
    expect(notes.length).toBe(1);
    expect([100, 300]).toContain(notes[0]!.x);

    a.close();
    b.close();
  });

  it("TC-11 a concurrent delete wins over a concurrent edit to the same note", async () => {
    const { boardId, a, b } = await twoClients();
    const id = await sharedNote({ boardId, a, b }, { x: 0, y: 0 }, "yellow", "keep me");

    a.transact((doc) => deleteObject(doc, id));
    b.transact((doc) => getStickyText(doc, id)?.insert(0, "ghost "));

    await expectConverged(boardId, [a, b]);
    expect(a.notes).toEqual([]);
    expect(b.notes).toEqual([]);
    expect(await roomSnapshot(boardId)).toEqual([]);

    // The edit cannot survive anywhere in the room's document either.
    const replay = new Y.Doc();
    Y.applyUpdate(replay, await inRoom(boardId, (room) => (room.doc === null ? new Uint8Array() : Y.encodeStateAsUpdate(room.doc))));
    expect(snapshot(replay).some((note) => note.text.includes("ghost"))).toBe(false);

    // Neither client was hurt by the conflict.
    expect(a.isClosed).toBe(false);
    expect(b.isClosed).toBe(false);

    a.close();
    b.close();
  });

  it(`TC-12 ${MAX_CONCURRENT_EDITORS} clients × 200 seeded edits converge to identical boards`, async () => {
    const seedBase = 20260815;
    const ops = 200;
    const boardId = testBoardId();

    const clients: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
      const client = await connectBoard(boardId);
      await client.waitForSync();
      clients.push(client);
    }

    const randoms = clients.map((_, index) => seededRandom(seedBase + index));
    const created: string[] = [];
    const deleted = new Set<string>();
    let applied = 0;

    // Interleaved: every client edits between the others' edits.
    for (let op = 0; op < ops; op += 1) {
      for (const [index, client] of clients.entries()) {
        const result = randomOp(client.requireDoc(), randoms[index]!);
        created.push(...result.created);
        for (const id of result.deleted) deleted.add(id);
        if (result.applied) applied += 1;
      }
    }
    console.log(`TC-12 seed=${seedBase} clients=${MAX_CONCURRENT_EDITORS} ops=${ops} applied=${applied} created=${created.length} deleted=${deleted.size}`);

    const notes = await expectConverged(boardId, clients, 30_000);
    const expected = JSON.stringify(notes);
    for (const client of clients) expect(JSON.stringify(client.notes)).toBe(expected);

    // A note nobody deleted is on every screen.
    const survivors = created.filter((id) => !deleted.has(id));
    expect(survivors.length).toBeGreaterThan(0);
    for (const id of survivors) {
      for (const client of clients) expect(client.notes.some((note) => note.id === id)).toBe(true);
    }
    for (const client of clients) expect(client.notes.length).toBe(survivors.length);

    for (const client of clients) client.close();
  });
});

// ---- joining, malformed traffic, awareness, restart ----------------------

describe("joining a board that already has content", () => {
  it("TC-14 a late joiner receives the notes created before it arrived", async () => {
    const { boardId, a, b } = await twoClients();

    for (let i = 0; i < 20; i += 1) {
      a.transact((doc) => createSticky(doc, { x: i * 40, y: (i % 5) * 40 }, i % 2 ? "green" : "blue"));
    }
    await b.waitForUpdates(20);
    await expectConverged(boardId, [a, b]);

    const late = await connectBoard(boardId);
    await late.waitForSync();

    await waitUntil(() => late.notes.length === 20);
    expect(JSON.stringify(late.notes)).toBe(JSON.stringify(a.notes));
    expect(JSON.stringify(late.notes)).toBe(JSON.stringify(b.notes));

    // The late joiner can write, too.
    late.transact((doc) => createSticky(doc, { x: 900, y: 900 }, "violet"));
    await a.waitForUpdates(1);
    await expectConverged(boardId, [a, b, late]);

    a.close();
    b.close();
    late.close();
  });
});

describe("malformed traffic", () => {
  const cases: { name: string; send: (client: TestClient) => void }[] = [
    { name: "text frame", send: (client) => client.sendRaw("hello, I am not a sync message") },
    { name: "truncated sync bytes", send: (client) => client.sendRaw(new Uint8Array([MESSAGE_SYNC, 2, 40, 1, 2])) },
    { name: "unknown message type", send: (client) => client.sendRaw(new Uint8Array([9, 1, 2, 3])) },
    {
      // Framed like a sync message, but the update inside it is not one Yjs
      // can read: `readSyncMessage` reports it through its error handler.
      name: "a sync body Yjs cannot apply",
      send: (client) => {
        const body = encoding.createEncoder();
        syncProtocol.writeUpdate(body, new Uint8Array([255, 255, 255, 255]));
        client.sendSync(encoding.toUint8Array(body));
      },
    },
  ];

  for (const testCase of cases) {
    it(`TC-15 ${testCase.name} closes only that socket`, async () => {
      const { boardId, a, b } = await twoClients();
      const other = await connectBoard(boardId);
      await other.waitForSync();

      expect((await roomSnapshot(boardId)) ?? []).toEqual([]);

      testCase.send(a);

      const closed = await a.waitForClose();
      expect(closed.code).toBe(CLOSE_UNSUPPORTED_DATA);
      expect(a.isClosed).toBe(true);

      // The room is untouched ...
      expect((await roomSnapshot(boardId)) ?? []).toEqual([]);

      // ... and the remaining sockets still work.
      other.transact((doc) => createSticky(doc, { x: 5, y: 5 }, "yellow"));
      await b.waitForUpdates(1);
      expect(b.isClosed).toBe(false);
      expect(other.isClosed).toBe(false);
      await expectConverged(boardId, [b, other]);

      b.close();
      other.close();
    });
  }
});

describe("awareness relay", () => {
  it("TC-16 awareness bytes are relayed to every socket, sender included", async () => {
    const { a, b } = await twoClients();
    const state = JSON.stringify({ 1: { name: "Alex", color: "#f00" } });
    const payload = new TextEncoder().encode(state);

    a.sendAwareness(payload);

    await waitUntil(() => a.awareness.length >= 1 && b.awareness.length >= 1);
    // The sender and the other socket hold byte-identical bodies: relayed
    // verbatim, and the sender is not skipped.
    expect(Array.from(a.awareness[0]!)).toEqual(Array.from(b.awareness[0]!));
    expect(awarenessJson(a.awareness[0]!)).toBe(state);
    expect(awarenessJson(b.awareness[0]!)).toBe(state);
    expect(a.awareness.length).toBe(1);
    expect(b.awareness.length).toBe(1);

    // Awareness never touches the document.
    expect(a.updateCount).toBe(0);
    expect(b.updateCount).toBe(0);

    // QueryAwareness is accepted and ignored (presence is story 6).
    a.sendQueryAwareness();
    await sleep(150);
    expect(a.isClosed).toBe(false);
    expect(b.isClosed).toBe(false);

    a.close();
    b.close();
  });
});

describe("room restart", () => {
  it("TC-18 the first client back rebuilds the room, the second then converges", async () => {
    const { boardId, a, b } = await twoClients();
    const id = await sharedNote({ boardId, a, b }, { x: 70, y: 70 }, "orange", "made before the restart");
    await expectConverged(boardId, [a, b]);

    // The room instance goes away, taking its document and both sockets with it.
    await restartRoom(boardId);
    await Promise.all([a.waitForClose(), b.waitForClose()]);
    expect(await roomSnapshot(boardId)).toBeNull();

    // A is back first, with the document its screen still holds.
    await a.reconnect();
    await a.waitForSync();
    await waitUntil(() => a.notes.length === 1);
    expect(a.notes[0]?.id).toBe(id);
    await waitUntilAsync(async () => (await roomSnapshot(boardId))?.length === 1);
    expect(await roomDocEquals(boardId, a.requireDoc())).toBe(true);
    expect((await roomSnapshot(boardId))?.[0]?.text).toBe("made before the restart");

    // B is back, and the three agree.
    await b.reconnect();
    await b.waitForSync();
    const notes = await expectConverged(boardId, [a, b]);
    expect(notes.map((note) => note.id)).toEqual([id]);

    // The rebuilt room still relays new edits.
    a.resetFrames();
    b.resetFrames();
    a.transact((doc) => createSticky(doc, { x: 300, y: 300 }, "pink"));
    await b.waitForUpdates(1);
    await expectConverged(boardId, [a, b]);

    a.close();
    b.close();
  });
});

describe("dead sockets", () => {
  it("TC-31 a peer that vanishes mid-broadcast does not break the room", async () => {
    const { boardId, a, b } = await twoClients();
    const watcher = await connectBoard(boardId);
    await watcher.waitForSync();
    watcher.resetFrames();

    // B disappears while A is editing.
    b.close(1001, "network drop");
    const id = a.transact((doc) => createSticky(doc, { x: 10, y: 10 }, "green"));
    expect(typeof id).toBe("string");

    await watcher.waitForUpdates(1);
    expect(watcher.notes.some((note) => note.id === id)).toBe(true);
    // Only B went away; the room did not close anyone else.
    expect(a.isClosed).toBe(false);
    expect(watcher.isClosed).toBe(false);

    // Sockets that join afterwards still get everything.
    const late = await connectBoard(boardId);
    await late.waitForSync();
    await expectConverged(boardId, [a, watcher, late]);

    const second = a.transact((doc) => createSticky(doc, { x: 30, y: 30 }, "pink"));
    await late.waitForUpdates(1);
    expect(late.notes.some((note) => note.id === second)).toBe(true);
    await expectConverged(boardId, [a, watcher, late]);

    a.close();
    b.close();
    watcher.close();
    late.close();
  });
});
