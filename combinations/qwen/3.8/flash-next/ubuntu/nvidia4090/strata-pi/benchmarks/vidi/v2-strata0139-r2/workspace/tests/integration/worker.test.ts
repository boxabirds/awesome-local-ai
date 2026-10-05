/**
 * Integration tests for `sync.worker_entry` — TC-04 to TC-06, TC-13, TC-17.
 *
 * Everything here runs inside workerd against the real Worker fetch handler,
 * the real BoardRoom class and real WebSockets. There are no mocks.
 */

import { describe, expect, it } from "vitest";
import { createSticky } from "../../src/shared/board-model";
import { MAX_CONCURRENT_EDITORS } from "../../src/shared/config";
import { newBoardId } from "../../src/shared/board-id";
import {
  connectBoard,
  fetchFromWorker,
  namespaceSpy,
  requestRoom,
  roomSnapshot,
  sleep,
  testBoardId,
} from "./helpers/ws-client";

describe("board id routing", () => {
  it("TC-04 answers 400 for a malformed board id and never opens an object", async () => {
    const { namespace, names } = namespaceSpy();
    const request = new Request("http://board.test/api/rooms/bad!id", { headers: { Upgrade: "websocket" } });

    const response = await fetchFromWorker(request, namespace);

    expect(response.status).toBe(400);
    // Routing refused before the namespace was consulted: no instance exists.
    expect(names).toEqual([]);
  });

  it("TC-04 boundary rejects ids one character off the length and wrong alphabets", async () => {
    const { namespace, names } = namespaceSpy();
    const valid = newBoardId();
    const rejected = [valid.slice(0, 21), `${valid}x`, `${valid.slice(0, 21)}!!`, ""];

    for (const boardId of rejected) {
      const response = await fetchFromWorker(
        new Request(`http://board.test/api/rooms/${encodeURIComponent(boardId)}`, {
          headers: { Upgrade: "websocket" },
        }),
        namespace,
      );
      expect(response.status).toBe(400);
    }
    expect(names).toEqual([]);
  });

  it("TC-05 answers 426 for a valid board id without an Upgrade header", async () => {
    const boardId = testBoardId();

    const response = await requestRoom(boardId, { upgrade: false });

    expect(response.status).toBe(426);
    expect(response.webSocket ?? null).toBeNull();
  });
});

describe("static assets fallback", () => {
  it("TC-06 serves index.html for a board route", async () => {
    const response = await requestRoom(testBoardId(), { path: `/b/${newBoardId()}`, upgrade: false });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(await response.text()).toContain('<div id="root">');
  });

  it("TC-06 also serves the app shell at the board-less root", async () => {
    const response = await requestRoom(testBoardId(), { path: "/", upgrade: false });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
  });
});

describe("capacity", () => {
  it(`TC-13 accepts MAX_CONCURRENT_EDITORS + 1 (${MAX_CONCURRENT_EDITORS + 1}) sockets and syncs them`, async () => {
    const boardId = testBoardId();
    const count = MAX_CONCURRENT_EDITORS + 1;

    const clients = [];
    for (let i = 0; i < count; i += 1) {
      const client = await connectBoard(boardId);
      expect(client.response.status).toBe(101);
      clients.push(client);
    }
    await Promise.all(clients.map((client) => client.waitForSync()));
    for (const client of clients) client.resetFrames();

    // The person who walked in last is treated like everyone else.
    const latecomer = clients[clients.length - 1]!;
    const id = latecomer.transact((doc) => createSticky(doc, { x: 300, y: 220 }, "orange"));
    expect(typeof id).toBe("string");

    for (const client of clients.slice(0, -1)) {
      await client.waitForUpdates(1);
    }
    expect(latecomer.updateCount).toBe(0); // nobody gets an echo

    const expected = JSON.stringify(latecomer.notes);
    for (const client of clients) {
      expect(JSON.stringify(client.notes)).toBe(expected);
    }
    expect((await roomSnapshot(boardId))?.length).toBe(1);

    for (const client of clients) client.close();
  });
});

describe("board isolation", () => {
  it("TC-17 keeps one board's edits out of another board's room", async () => {
    const board1 = testBoardId();
    const board2 = testBoardId();
    expect(board1).not.toBe(board2);

    const alex = await connectBoard(board1);
    const sam = await connectBoard(board2);
    await alex.waitForSync();
    await sam.waitForSync();

    alex.transact((doc) => createSticky(doc, { x: 100, y: 100 }, "yellow"));
    await alex.waitForRoomNotes(1);

    // Nothing crossed over: Sam's socket stayed quiet and room2 stayed empty.
    sam.resetFrames();
    alex.resetFrames();
    await sleep(400);
    expect(sam.frames.length).toBe(0);
    expect(sam.updateCount).toBe(0);
    expect(sam.notes).toEqual([]);
    expect(await roomSnapshot(board2)).toEqual([]);

    // ...while room1 really did hold Alex's note (so the test is not vacuous).
    expect((await roomSnapshot(board1))?.length).toBe(1);

    alex.close();
    sam.close();
  });
});
