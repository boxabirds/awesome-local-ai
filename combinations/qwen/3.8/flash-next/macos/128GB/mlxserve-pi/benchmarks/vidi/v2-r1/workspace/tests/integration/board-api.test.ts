/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * The board creation and existence API (share.board_api), against the real
 * Worker entry, the real BoardRoom Durable Object and real SQLite storage.
 *
 * What is under test here is exactly what a link depends on: the status codes,
 * and the promise that asking about a board that is not there writes nothing
 * (share.not_found). Durable Object RPC (`initialize`, `exists`) and the SQLite
 * existence read are real, because the "no storage written" guarantee is a
 * storage fact and cannot be checked against a mock (design: Mock vs real).
 *
 * Spec: spec/stories/005-share-a-board-with-others-using-a-link/design.md,
 * section "Board creation and existence API" (TC-05 to TC-10, TC-12, TC-14,
 * TC-15, TC-32).
 */
import { describe, expect, it } from 'vitest';
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { createBoard as createBoardServer } from '../../src/worker/create-board';
import { createSticky, snapshot } from '../../src/shared/board-model';
import type { Env } from '../../src/worker/index';
import type { BoardRoom } from '../../src/worker/board-room';
import {
  canonicalNotes,
  createBoard,
  seeSameBoard,
  SyncClient,
  waitFor,
} from './helpers/ws-client';

const upgradeHeaders = { Upgrade: 'websocket', Connection: 'Upgrade' };

/** The room stub for a board id, typed for Durable Object RPC. */
const stubFor = (boardId: string): DurableObjectStub<BoardRoom> =>
  env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)) as DurableObjectStub<BoardRoom>;

/** How many times the namespace was asked for a stub. A malformed id must not
 * make it ask at all (TC-07), which is the observable form of "no RPC call made"
 * — the object is only ever reached through `get`. */
let namespaceLookups = 0;
const realGet = env.BOARD_ROOM.get.bind(env.BOARD_ROOM);
(env.BOARD_ROOM as unknown as { get: (...args: unknown[]) => unknown }).get = (
  ...args: unknown[]
) => {
  namespaceLookups += 1;
  return realGet(...(args as [never]));
};

/** The names of the tables this board's storage holds, read from inside it. */
const tableNames = (boardId: string): Promise<string[]> =>
  runInDurableObject(stubFor(boardId), (_room, state) =>
    state.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .toArray()
      .map((row) => String(row['name'])),
  );

/** The raw `created_at` value, or null, read from inside the room. */
const createdAtOf = (boardId: string): Promise<string | null> =>
  runInDurableObject(stubFor(boardId), (_room, state) => {
    const row = state.storage.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', 'created_at')
      .toArray()[0];
    return row === undefined ? null : String(row['value']);
  });

/** One real Yjs update holding `count` notes, base64-encoded for the seed hook. */
const realUpdates = (count: number): string[] => {
  const doc = new Y.Doc();
  for (let index = 0; index < count; index += 1) createSticky(doc, { x: index * 10, y: 0 });
  return [btoa(String.fromCharCode(...Y.encodeStateAsUpdate(doc)))];
};

describe('creating a board (share.board_api)', () => {
  // TC-05: POST makes a board; GET finds it; created_at is set in its storage.
  it('creates a board, finds it again, and stamps it created (TC-05)', async () => {
    const response = await SELF.fetch('https://vidi6.test/api/boards', { method: 'POST' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(BOARD_ID_PATTERN.test(body.id)).toBe(true);

    const check = await SELF.fetch(`https://vidi6.test/api/boards/${body.id}`);
    expect(check.status).toBe(200);
    expect(await check.json()).toEqual({ id: body.id });

    expect(await createdAtOf(body.id)).not.toBeNull();
  });

  // TC-06 (negative): asking about an unknown board must not create anything.
  it('does not create storage for an unknown board it is asked about (TC-06)', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`https://vidi6.test/api/boards/${boardId}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });

    // The check reads the catalogue and writes nothing: no table exists after it.
    expect(await tableNames(boardId)).toEqual([]);
  });

  // TC-07 (negative): a malformed id is answered without waking the object.
  it('answers a malformed board id without any Durable Object call (TC-07)', async () => {
    const before = namespaceLookups;
    for (const bad of ['abc', 'x'.repeat(23)]) {
      const response = await SELF.fetch(`https://vidi6.test/api/boards/${bad}`);
      expect(response.status, bad).toBe(404);
      expect(await response.json(), bad).toEqual({ error: 'not_found' });
    }
    // Nothing about a malformed id reaches the namespace, so no object, no RPC.
    expect(namespaceLookups, 'malformed ids never touch the namespace').toBe(before);
  });

  // TC-08 (share.legacy_boards): a board with saved content but no created_at
  // — a board made before story 5 — counts as existing.
  it('recognises a legacy board with content and no created_at as existing (TC-08)', async () => {
    const boardId = newBoardId();
    // Write real Yjs updates and do NOT set created_at, exactly as a board made
    // before this story did.
    expect((await stubFor(boardId).seedLegacy(realUpdates(2))).ok).toBe(true);
    expect(await createdAtOf(boardId)).toBeNull();

    const response = await SELF.fetch(`https://vidi6.test/api/boards/${boardId}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: boardId });
  });

  // TC-14: only POST creates; any other method on the collection is refused.
  it('refuses a method that is not POST on the boards collection (TC-14)', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH', 'GET']) {
      const response = await SELF.fetch('https://vidi6.test/api/boards', { method });
      expect(response.status, method).toBe(405);
    }
  });

  // TC-15 (negative): a board that exists is never re-initialised; its
  // created_at never moves.
  it('initialises a board once: created then exists, created_at unchanged (TC-15)', async () => {
    const boardId = newBoardId();
    const stub = stubFor(boardId);
    const first = await stub.initialize();
    const createdFirst = await createdAtOf(boardId);
    const second = await stub.initialize();
    const createdSecond = await createdAtOf(boardId);

    expect(first).toBe('created');
    expect(second).toBe('exists');
    expect(createdFirst).not.toBeNull();
    expect(createdSecond).toBe(createdFirst);
  });

  // TC-12: a creation whose RPC fails answers 500 create_failed. Forcing a real
  // RPC failure on demand is not possible, so a namespace whose initialize()
  // throws stands in (design: Mock vs real — RPC failure is injected).
  it('answers 500 when the create RPC throws (TC-12)', async () => {
    const throwing: Env = {
      BOARD_ROOM: {
        idFromName: (name: string) => env.BOARD_ROOM.idFromName(name),
        get: () => ({ initialize: async () => { throw new Error('the object would not start'); } }),
      } as unknown as Env['BOARD_ROOM'],
      ASSETS: env.ASSETS,
      ASSETS_BUCKET: env.ASSETS_BUCKET,
    };
    expect(await createBoardServer(throwing)).toEqual({ ok: false, reason: 'create_failed' });

    // And an initialize() that answers 'exists' for a freshly generated id — the
    // collision case — is the same failure, with no retry loop.
    const collision: Env = {
      BOARD_ROOM: {
        idFromName: (name: string) => env.BOARD_ROOM.idFromName(name),
        get: () => ({ initialize: async () => 'exists' as const }),
      } as unknown as Env['BOARD_ROOM'],
      ASSETS: env.ASSETS,
      ASSETS_BUCKET: env.ASSETS_BUCKET,
    };
    expect(await createBoardServer(collision)).toEqual({ ok: false, reason: 'create_failed' });
  });
});

describe('opening a board link (share.board_api)', () => {
  // TC-09 (negative): connecting to a board nobody created must not open a
  // socket or create a board.
  it('refuses a websocket upgrade to an unknown board and creates nothing (TC-09)', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`https://vidi6.test/api/rooms/${boardId}`, {
      headers: upgradeHeaders,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(response.webSocket).toBeNull();
    // Refusing the connection wrote nothing: there are no tables.
    expect(await tableNames(boardId)).toEqual([]);
  });

  // TC-10: a board created over HTTP can be connected to, and story 3's live
  // sync still works over it.
  it('connects to a board created over HTTP and syncs as story 3 (TC-10)', async () => {
    const boardId = await createBoard();
    const a = await SyncClient.connect(boardId);
    await a.waitForSync();
    const b = await SyncClient.connect(boardId);
    await b.waitForSync();

    const noteId = a.addNote({ x: 20, y: 20 });
    expect(noteId).toBeTruthy();
    await waitFor(() => seeSameBoard(a, b), 'the second person to see the note');
    expect(canonicalNotes(b.notes)).toBe(canonicalNotes(a.notes));

    a.close();
    b.close();
  });

  // TC-32 (negative, privacy): the served app shell must not leak the board link
  // as a Referer to anything on another origin.
  it('serves the app shell with a no-referrer policy (TC-32)', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`https://vidi6.test/b/${boardId}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<meta\b[^>]*name=["']referrer["'][^>]*content=["']no-referrer["']/i);
    // A sanity check that this really is the app shell for a board address.
    expect(isValidBoardId(boardId)).toBe(true);
    expect(html).toContain('<div id="root">');
    void snapshot;
  });
});
