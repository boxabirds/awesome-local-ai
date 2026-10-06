/**
 * Integration tests for the board API (`share.board_api`) — TC-05 to TC-10,
 * TC-12, TC-14, TC-15, TC-32.
 *
 * These run inside workerd against the real Worker fetch handler, the real
 * BoardRoom Durable Object (its RPC methods called through the real stub) and
 * real SQLite-backed DO storage. The two things this story is really about —
 * the *existence rule* and the *no-write-on-probe* guarantee — are storage
 * facts, so they are read out of SQLite rather than inferred from status codes.
 */

import { describe, expect, it } from "vitest";
import { createSticky } from "../../src/shared/board-model";
import { isValidBoardId, newBoardId } from "../../src/shared/board-id";
import { env } from "cloudflare:test";
import { BoardStore } from "../../src/worker/board-store";
import { createBoard } from "../../src/worker/create-board";
import { retroBoard } from "../fixtures/boards";
import {
  checkBoardApi,
  connectBoard,
  createTestBoard,
  expectConverged,
  fetchFromWorker,
  inRoom,
  namespaceSpy,
  namespaceWithFailingInitialize,
  requestBoards,
  requestRoom,
  roomSnapshot,
  testBoardId,
} from "./helpers/ws-client";

// ---- looking at the storage an unknown id does (not) have -----------------

/** Table names this board's SQLite database has. */
function tableNames(boardId: string): Promise<string[]> {
  return inRoom(boardId, (room) => {
    const storage = (room as unknown as { ctx: DurableObjectState }).ctx.storage;
    return storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .toArray()
      .map((row) => String(row["name"]));
  });
}

/** `created_at` straight out of `storage_meta`, or null when it was never written. */
function createdAtRow(boardId: string): Promise<number | null> {
  return inRoom(boardId, (room) => {
    const storage = (room as unknown as { ctx: DurableObjectState }).ctx.storage;
    const store = new BoardStore(storage);
    return store.createdAt();
  });
}

/** Row counts of the board's tables, or `null` when the tables do not exist. */
function rowCount(boardId: string, table: string): Promise<number | null> {
  return inRoom(boardId, (room) => {
    const storage = (room as unknown as { ctx: DurableObjectState }).ctx.storage;
    const tables = storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table)
      .toArray();
    if (tables.length === 0) return null;
    return Number(storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one()["n"]);
  });
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Gives a never-created board saved content *without* `created_at` — a board
 * that was already in use at this address before story 5 shipped
 * (`share.legacy_boards`). Written through the room's real apply-then-store path.
 */
async function seedLegacyBoard(boardId: string, notes = 3): Promise<number> {
  const fixture = retroBoard(notes);
  return inRoom(boardId, (room) => room.seedBoardUpdates(fixture.updates.map(base64)));
}

// ---- POST /api/boards -----------------------------------------------------

describe("creating a board (TC-05, TC-12, TC-14, TC-15)", () => {
  it("TC-05 POST /api/boards creates a board that GET then finds", async () => {
    const created = await requestBoards({ method: "POST" });

    expect(created.status).toBe(201);
    const body = (await created.json()) as { id?: unknown };
    expect(typeof body.id).toBe("string");
    const boardId = body.id as string;
    expect(isValidBoardId(boardId)).toBe(true);
    expect(boardId).toHaveLength(22);

    const checked = await checkBoardApi(boardId);
    expect(checked.status).toBe(200);
    expect((await checked.json() as { id: string }).id).toBe(boardId);

    // The board is a real board: its creation stamp is in storage.
    expect(await createdAtRow(boardId)).toBeTypeOf("number");
    expect(await rowCount(boardId, "updates")).toBe(0);
  });

  it("TC-05 creation is one id and one write (the POST fits CREATE_BUDGET_MS)", async () => {
    const startedAt = Date.now();
    const boardId = await createTestBoard();
    const elapsedMs = Date.now() - startedAt;
    console.log(`TC-05 POST /api/boards took ${elapsedMs} ms (CREATE_BUDGET_MS 2000 ms)`);
    expect(elapsedMs).toBeLessThan(2_000);
    expect(isValidBoardId(boardId)).toBe(true);
  });

  it("TC-12 an RPC that throws answers 500 create_failed", async () => {
    const response = await fetchFromWorker(
      new Request("http://board.test/api/boards", { method: "POST" }),
      namespaceWithFailingInitialize(),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "create_failed" });
  });

  it("TC-12 createBoard itself reports create_failed rather than retrying another id", async () => {
    const result = await createBoard({ ...env, BOARD_ROOM: namespaceWithFailingInitialize() });
    expect(result).toEqual({ ok: false, reason: "create_failed" });
  });

  it("TC-14 a method the board API does not implement answers 405", async () => {
    for (const method of ["PUT", "DELETE", "PATCH"]) {
      const response = await requestBoards({ method });
      expect(response.status).toBe(405);
    }
  });

  it("TC-15 initialize() on a board that exists reports exists and keeps created_at", async () => {
    const boardId = await createTestBoard();
    const first = await createdAtRow(boardId);
    expect(first).toBeTypeOf("number");

    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    const outcome = await stub.initialize();
    expect(outcome).toBe("exists");

    // Not re-initialised: the stamp is untouched (negative: a board's creation
    // time must not move because somebody asked again).
    expect(await createdAtRow(boardId)).toBe(first);
  });
});

// ---- GET /api/boards/:id --------------------------------------------------

describe("opening a board link (TC-06, TC-07, TC-08)", () => {
  it("TC-06 an unknown but valid id is 404 and leaves no storage behind", async () => {
    const boardId = testBoardId();

    const response = await checkBoardApi(boardId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });

    // The negative half: asking about a link created nothing at that link.
    expect(await tableNames(boardId)).toEqual([]);
    expect(await rowCount(boardId, "updates")).toBeNull();
    expect(await createdAtRow(boardId)).toBeNull();
  });

  it("TC-07 a malformed id is 404 without touching the namespace at all", async () => {
    const { namespace, names } = namespaceSpy();
    const valid = newBoardId();
    const malformed = ["abc", `${valid}x`, valid.slice(0, 21), "../../secret", "a%20b"];

    for (const id of malformed) {
      const response = await fetchFromWorker(
        new Request(`http://board.test/api/boards/${encodeURIComponent(id)}`, { method: "GET" }),
        namespace,
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }

    // Not one Durable Object was looked up: malformed ids never reach the DO.
    expect(names).toEqual([]);
  });

  it("TC-08 a board with saved content but no created_at still exists (legacy)", async () => {
    const boardId = testBoardId();
    const seeded = await seedLegacyBoard(boardId, 3);
    expect(seeded).toBeGreaterThan(0);

    // The fixture really is legacy: content, and no creation stamp.
    expect(await createdAtRow(boardId)).toBeNull();
    expect(await rowCount(boardId, "updates")).toBeGreaterThan(0);

    const response = await checkBoardApi(boardId);
    expect(response.status).toBe(200);
    expect((await response.json() as { id: string }).id).toBe(boardId);

    // And the legacy content is the board it always was.
    expect((await roomSnapshot(boardId))?.length).toBe(3);
  });

  it("TC-08 a legacy board is not brought up to date by being asked about", async () => {
    const boardId = testBoardId();
    await seedLegacyBoard(boardId, 2);

    await checkBoardApi(boardId);
    expect(await createdAtRow(boardId)).toBeNull();
  });
});

// ---- /api/rooms/:id -------------------------------------------------------

describe("connecting to a board (TC-09, TC-10)", () => {
  it("TC-09 a socket to an unknown board is refused with 404 and writes nothing", async () => {
    const boardId = testBoardId();

    const response = await requestRoom(boardId);
    expect(response.status).toBe(404);
    expect(response.webSocket ?? null).toBeNull();
    expect(await response.json()).toEqual({ error: "not_found" });

    expect(await tableNames(boardId)).toEqual([]);

    // A malformed id is refused the same way (story 3's 400 became story 5's 404).
    const malformed = await requestRoom("bad!id");
    expect(malformed.status).toBe(404);
    expect(malformed.webSocket ?? null).toBeNull();
  });

  it("TC-09 a valid board id without an Upgrade header is still 426", async () => {
    const boardId = await createTestBoard();
    const response = await requestRoom(boardId, { upgrade: false });
    expect(response.status).toBe(426);
  });

  it("TC-10 a created board accepts a socket and syncs like story 3", async () => {
    const boardId = await createTestBoard();

    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);
    expect(a.response.status).toBe(101);
    expect(b.response.status).toBe(101);
    await a.waitForSync();
    await b.waitForSync();

    a.transact((doc) => createSticky(doc, { x: 120, y: 80 }, "blue"));
    await b.waitForUpdates(1);
    const notes = await expectConverged(boardId, [a, b]);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.color).toBe("blue");

    a.close();
    b.close();
  });
});

// ---- privacy (TC-32) ------------------------------------------------------

describe("served app shell (TC-32)", () => {
  it("TC-32 index.html tells the browser never to send a Referer", async () => {
    const response = await requestRoom(testBoardId(), { path: "/", upgrade: false });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
    expect(html).toContain('<div id="root">');
  });

  it("TC-32 the board route still answers with the app shell", async () => {
    const boardId = newBoardId();
    const response = await requestRoom(testBoardId(), { path: `/b/${boardId}`, upgrade: false });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
  });
});

// ---- test hooks are off without TEST_HOOKS --------------------------------

describe("test-only routes", () => {
  it("the legacy-board hook is a 404 when TEST_HOOKS is not set", async () => {
    const response = await fetchFromWorker(
      new Request("http://board.test/__test-hooks/legacy-board", {
        method: "POST",
        body: JSON.stringify({ id: newBoardId(), updates: [] }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("the legacy-board hook works when TEST_HOOKS is set, and leaves no created_at", async () => {
    const boardId = newBoardId();
    const fixture = retroBoard(2);
    const body = JSON.stringify({ id: boardId, updates: fixture.updates.map(base64) });

    const response = await fetchFromWorker(
      new Request("http://board.test/__test-hooks/legacy-board", { method: "POST", body }),
      undefined,
      { TEST_HOOKS: "1" },
    );
    expect(response.status).toBe(200);
    expect((await response.json() as { ok: boolean }).ok).toBe(true);

    const checked = await checkBoardApi(boardId);
    expect(checked.status).toBe(200);
    expect(await createdAtRow(boardId)).toBeNull();
    expect((await roomSnapshot(boardId))?.length).toBe(2);
  });
});
