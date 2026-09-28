// Creating a board, checking a link, and what a link that is nobody's board does.
//
// Everything here goes through the endpoints (POST /api/boards, GET
// /api/boards/:id, GET /api/rooms/:id) or the board's own Durable Object, because
// those are the things that actually exist. What a test asserts is the board's
// OWN storage afterwards - which tables exist, which meta keys exist, what
// `exists()` answers - because a created board is not a response body, it is
// storage.
//
// Visitors are IP addresses: the create limit counts a visitor, so a test that
// needs N boards takes N addresses (TEST-NET ranges, which cannot collide with a
// real bucket the suite happens to use).
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import { newBoardId, isValidBoardId } from '../../src/shared/board-id.ts';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '../../src/shared/config.ts';
import { createWithRetries } from '../../src/worker/create-board.ts';
import { createSticky, initDoc } from '../../src/shared/board-model.ts';
import { TestClient } from './helpers/ws-client.ts';
import {
  metaKeys,
  seedFromInside,
  metaValue,
  roomIdFor,
  roomExists,
  roomInitialize,
  rowCount,
  sql,
  tableNames,
} from './helpers/room.ts';

/** A visitor address no other test in this file spends its quota on. */
let visitor = 0;
function visitorIp(prefix = 203): string {
  visitor += 1;
  return `${prefix}.0.113.${visitor}`;
}

async function postCreate(ip: string, extraHeaders: Record<string, string> = {}) {
  const res = await SELF.fetch('http://board.test/api/boards', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip, ...extraHeaders },
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { res, body };
}

/** A board made the way a visitor makes one. */
async function createBoardViaEndpoint(ip = visitorIp()): Promise<string> {
  const { res, body } = await postCreate(ip);
  if (res.status !== 201 || typeof body?.id !== 'string') {
    throw new Error(`expected 201 with an id, got ${res.status} ${JSON.stringify(body)}`);
  }
  return body.id;
}

const getBoard = (boardId: string) => SELF.fetch(`http://board.test/api/boards/${boardId}`);
const upgradeTo = (boardId: string) =>
  SELF.fetch(`http://board.test/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
  });

// The four tables a created board has, in the order the store creates them,
// sorted the way the helper's ORDER BY name sorts them.
const SCHEMA_TABLES = ['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates'];

describe('TC-05 creating a board makes a board', () => {
  it('a created code is a valid code, is answerable, and is the board it names', async () => {
    const boardId = await createBoardViaEndpoint();

    expect(isValidBoardId(boardId)).toBe(true);

    const res = await getBoard(boardId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: boardId });

    expect(await roomExists(boardId)).toBe(true);
  });

  it('the board is storage, not a response body: four tables, one creation stamp', async () => {
    const boardId = await createBoardViaEndpoint();

    expect(await tableNames(boardId)).toEqual(SCHEMA_TABLES);
    expect((await metaKeys(boardId)).sort()).toEqual(['created_at', 'storage_schema_version']);
    // Creating a board writes a stamp, not content.
    expect(await rowCount(boardId, 'updates')).toBe(0);
    expect(await rowCount(boardId, 'snapshot_chunks')).toBe(0);
  });
});

describe('TC-06 a code that was never created is not a board', () => {
  it('answers 404 every time it is asked, and never stops answering 404', async () => {
    const boardId = newBoardId();

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await getBoard(boardId);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    expect(await roomExists(boardId)).toBe(false);
  });

  it('leaves nothing behind: no table, no meta key, before or after being asked', async () => {
    const boardId = newBoardId();

    expect(await tableNames(boardId)).toEqual([]);
    expect(await metaKeys(boardId)).toEqual([]);
    await getBoard(boardId);
    await getBoard(boardId);
    expect(await tableNames(boardId)).toEqual([]);
    expect(await metaValue(boardId, 'created_at')).toBeNull();
    expect(await roomExists(boardId)).toBe(false);
  });
});

describe('TC-07 the creation stamp is written once, by the board itself', () => {
  it('initialize answers created the first time and exists for every time after', async () => {
    const boardId = newBoardId();
    expect(await roomExists(boardId)).toBe(false);

    expect(await roomInitialize(boardId)).toBe('created');
    const first = await metaValue(boardId, 'created_at');
    expect(Number.isFinite(Number(first))).toBe(true);

    // Asking again is not creating again: the stamp is the one that was written
    // first, and nothing else about the board changes.
    expect(await roomInitialize(boardId)).toBe('exists');
    expect(await metaValue(boardId, 'created_at')).toBe(first);
    expect((await metaKeys(boardId)).sort()).toEqual(['created_at', 'storage_schema_version']);
  });

  it('a board made by POST is already created as far as its own room is concerned', async () => {
    const boardId = await createBoardViaEndpoint();
    const stamp = await metaValue(boardId, 'created_at');
    expect(await roomInitialize(boardId)).toBe('exists');
    expect(await metaValue(boardId, 'created_at')).toBe(stamp);
  });
});

describe('TC-08 a collision creates nothing for the code that was already taken', () => {
  it('a code answered exists is dropped without touching the board that holds it', async () => {
    const taken = await createBoardViaEndpoint();
    const stampBefore = await metaValue(taken, 'created_at');
    expect(stampBefore).not.toBeNull();

    // The room's real answer for a code it already owns, through the real RPC.
    const outcome = await createWithRetries(
      () => taken,
      (id) => roomInitialize(id),
      CREATE_ID_MAX_ATTEMPTS,
    );

    expect(outcome).toEqual({ ok: false });
    expect(await metaValue(taken, 'created_at')).toBe(stampBefore);
    expect(await rowCount(taken, 'updates')).toBe(0);
    expect((await metaKeys(taken)).sort()).toEqual(['created_at', 'storage_schema_version']);
  });

  it('after a collision the next code is the board, and the first board is unchanged', async () => {
    const taken = await createBoardViaEndpoint();
    const stampBefore = await metaValue(taken, 'created_at');
    const fresh = newBoardId();

    const codes = [taken, fresh];
    let handed = 0;
    const outcome = await createWithRetries(
      () => codes[handed++],
      (id) => roomInitialize(id),
      CREATE_ID_MAX_ATTEMPTS,
    );

    expect(outcome).toEqual({ ok: true, id: fresh });
    expect(handed).toBe(2);
    expect(await roomExists(fresh)).toBe(true);
    expect(await roomExists(taken)).toBe(true);
    // The new board is a board of its own: its own stamp, its own object.
    expect(await metaValue(fresh, 'created_at')).not.toBeNull();
    expect(roomIdFor(fresh)).not.toBe(roomIdFor(taken));
    // ... and the board that was already there is exactly as it was.
    expect(await metaValue(taken, 'created_at')).toBe(stampBefore);
  });
});

describe('TC-09 an upgrade to a board that does not exist is refused', () => {
  it('a valid code nobody created gets 404, not a socket and not a board', async () => {
    const boardId = newBoardId();

    const res = await upgradeTo(boardId);
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeFalsy();

    // Refusing to serve a board must not be the same as making one.
    expect(await roomExists(boardId)).toBe(false);
    expect(await tableNames(boardId)).toEqual([]);
    expect((await getBoard(boardId)).status).toBe(404);
  });

  it('a malformed code gets the same answer, and no room is instantiated for it', async () => {
    const res = await upgradeTo('bad!id');
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeFalsy();
    expect(await res.json()).toEqual({ error: 'not_found' });

    const check = await getBoard('bad!id');
    expect(check.status).toBe(404);
    expect(await check.json()).toEqual({ error: 'not_found' });
  });

  it('asking for a non-existent board a second time still refuses', async () => {
    const boardId = newBoardId();
    expect((await upgradeTo(boardId)).status).toBe(404);
    expect((await upgradeTo(boardId)).status).toBe(404);
    expect(await roomExists(boardId)).toBe(false);
  });
});

describe('TC-10 the room holds one board per code, and each board holds only itself', () => {
  it('boards created back to back are distinct codes with distinct rooms and one stamp each', async () => {
    const ids: string[] = [];
    for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
      ids.push(await createBoardViaEndpoint(visitorIp(198)));
    }

    expect(new Set(ids).size).toBe(BOARD_CREATE_LIMIT);
    expect(new Set(ids.map(roomIdFor)).size).toBe(BOARD_CREATE_LIMIT);

    for (const id of ids) {
      expect(await tableNames(id)).toEqual(SCHEMA_TABLES);
      expect(await rowCount(id, 'updates')).toBe(0);
      expect(await rowCount(id, 'snapshot_chunks')).toBe(0);
      expect(await rowCount(id, 'quarantined_updates')).toBe(0);
      expect((await metaKeys(id)).sort()).toEqual(['created_at', 'storage_schema_version']);
      // One creation stamp per board: the count of that key is the story of
      // whether ten codes became ten boards or ten writes into one.
      const stamped = await sql<{ n: number }>(
        id,
        `SELECT COUNT(*) AS n FROM storage_meta WHERE key = ?`,
        ['created_at'],
      );
      expect(Number(stamped[0]?.n ?? 0)).toBe(1);
    }
  });

  it('a board created second does not appear in the board created first', async () => {
    const first = await createBoardViaEndpoint(visitorIp(198));
    const second = await createBoardViaEndpoint(visitorIp(198));
    expect(await metaValue(second, 'created_at')).not.toBe(await metaValue(first, 'created_at'));
    expect(await tableNames(second)).toEqual(SCHEMA_TABLES);
  });
});

describe('TC-11 the create limit is enforced at its boundary', () => {
  it('the limit-th request is a board and the one after it is a 429', async () => {
    const ip = visitorIp(192);
    const ids: string[] = [];
    for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
      const { res, body } = await postCreate(ip);
      expect(res.status).toBe(201);
      ids.push(String(body?.id));
    }
    expect(new Set(ids).size).toBe(BOARD_CREATE_LIMIT);

    const limited = await postCreate(ip);
    expect(limited.res.status).toBe(429);
    expect(limited.body).toEqual({ error: 'rate_limited' });
    // A limited request hands out nothing at all.
    expect(typeof limited.body?.id).toBe('undefined');
    // The boards that were made are boards.
    expect((await getBoard(ids[0])).status).toBe(200);
    expect((await getBoard(ids[BOARD_CREATE_LIMIT - 1])).status).toBe(200);
  });

  it('a different visitor is not the visitor who was limited', async () => {
    const limited = visitorIp(192);
    for (let i = 0; i < BOARD_CREATE_LIMIT; i++) await createBoardViaEndpoint(limited);
    expect((await postCreate(limited)).res.status).toBe(429);

    const other = await postCreate(visitorIp(192));
    expect(other.res.status).toBe(201);
    expect(isValidBoardId(String(other.body?.id))).toBe(true);
  });

  it('checking whether a board exists does not use up the right to create one', async () => {
    const ip = visitorIp(192);
    const missing = newBoardId();
    for (let i = 0; i < 5; i++) {
      const res = await getBoard(missing);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    const created = await postCreate(ip);
    expect(created.res.status).toBe(201);
    expect(await roomExists(String(created.body?.id))).toBe(true);
  });

  it('the limit that is enforced is the limit the code says, and it is not zero or huge', async () => {
    expect(BOARD_CREATE_LIMIT).toBe(10);
    expect(BOARD_CREATE_PERIOD_SECONDS).toBe(60);
    // The boundary was just walked above: exactly BOARD_CREATE_LIMIT boards, then
    // a refusal. A period of 60 seconds means a test may never create an eleventh
    // board on an address it has already used up.
  });
});

describe('TC-13 a created board serves a connection', () => {
  it('a client that connects to a freshly created board syncs, edits and is stored', async () => {
    const boardId = await createBoardViaEndpoint();

    const client = await TestClient.connect(boardId);
    await client.waitForSync();
    expect(client.open).toBe(true);

    const noteId = createSticky(client.doc, { x: 11, y: 22 });
    await client.waitFor(
      () => client.snapshot().some((note) => note.id === noteId),
      1000,
      'the client sees its own note',
    );

    // The board is not only online: the note reached the board's own storage.
    await waitUntil('the note is in the update log', async () => (await rowCount(boardId, 'updates')) > 0);
    expect(await rowCount(boardId, 'snapshot_chunks')).toBe(0);

    // And the board is still a board after all that.
    expect((await getBoard(boardId)).status).toBe(200);
    client.close();
  });

  it('two clients on a created board collaborate on it', async () => {
    const boardId = await createBoardViaEndpoint();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await Promise.all([a.waitForSync(), b.waitForSync()]);

    const noteId = createSticky(a.doc, { x: 3, y: 4 });
    await b.waitFor(
      () => b.snapshot().some((note) => note.id === noteId),
      1000,
      'the second client sees the note',
    );
    a.close();
    b.close();
  });
});

describe('TC-14 the limit counts visitors, not boards', () => {
  it('ten visitors get ten boards and an eleventh visitor gets a board too', async () => {
    const ids: string[] = [];
    for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
      const { res, body } = await postCreate(visitorIp(192));
      expect(res.status).toBe(201);
      ids.push(String(body?.id));
    }
    // A visitor who has not asked before is not limited by what others did.
    const eleventh = await postCreate(visitorIp(192));
    expect(eleventh.res.status).toBe(201);
    ids.push(String(eleventh.body?.id));

    expect(new Set(ids).size).toBe(BOARD_CREATE_LIMIT + 1);
    for (const id of ids) expect(await roomExists(id)).toBe(true);
  });
});

describe('TC-15 a mistyped link creates nothing, until something does create a board', () => {
  it('three looks at a made-up code create no storage, and creating it is what changes that', async () => {
    const boardId = newBoardId();

    for (let i = 0; i < 3; i++) expect((await getBoard(boardId)).status).toBe(404);
    expect((await upgradeTo(boardId)).status).toBe(404);
    expect(await tableNames(boardId)).toEqual([]);
    expect(await metaKeys(boardId)).toEqual([]);
    expect(await roomExists(boardId)).toBe(false);

    // The absence above was real: the same code, created the way a visitor
    // creates one, is a board from that moment on.
    expect(await roomInitialize(boardId)).toBe('created');
    expect((await getBoard(boardId)).status).toBe(200);
    expect(await roomExists(boardId)).toBe(true);
    expect(await tableNames(boardId)).toEqual(SCHEMA_TABLES);
  });

  it('a code that was probed and then created carries one stamp, not two', async () => {
    const boardId = newBoardId();
    await getBoard(boardId);
    await upgradeTo(boardId);
    expect(await roomInitialize(boardId)).toBe('created');
    expect(await roomInitialize(boardId)).toBe('exists');
    const stamped = await sql<{ n: number }>(
      boardId,
      `SELECT COUNT(*) AS n FROM storage_meta WHERE key = ?`,
      ['created_at'],
    );
    expect(Number(stamped[0]?.n ?? 0)).toBe(1);
  });
});

describe('TC-32 a board page does not tell the page it linked out of', () => {
  it('the document a visitor lands on declares a no-referrer policy', async () => {
    const res = await SELF.fetch('http://board.test/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<meta\s+name=["']referrer["']\s+content=["']no-referrer["']/i);
  });

  it('the board page itself carries it too', async () => {
    const boardId = await createBoardViaEndpoint();
    const res = await SELF.fetch(`http://board.test/b/${boardId}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(
      /<meta\s+name=["']referrer["']\s+content=["']no-referrer["']/i,
    );
  });

  it('a document served for an unknown board still carries it', async () => {
    const res = await SELF.fetch(`http://board.test/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(
      /<meta\s+name=["']referrer["']\s+content=["']no-referrer["']/i,
    );
  });
});

// The existence rule, checked where the storage actually is. A board that was
// made before this story exists has content and no creation stamp, so the rule
// reads two separate things - the stamp, or any content at all - and either half
// alone has to be enough. These tests take the rule one half at a time: whatever
// the other half would have contributed is removed, so a pass is about the half
// being claimed and not about the other one.
describe('the existence rule, read out of real storage', () => {
  it('content with no creation stamp is a board, through the snapshot half of the rule', async () => {
    const boardId = newBoardId();
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 1, y: 1 });
    await seedFromInside(boardId, Y.encodeStateAsUpdate(doc));

    expect(await tableNames(boardId)).toEqual(SCHEMA_TABLES);
    expect(await metaValue(boardId, 'created_at')).toBeNull();
    expect(await rowCount(boardId, 'snapshot_chunks')).toBeGreaterThan(0);
    expect(await roomExists(boardId)).toBe(true);
    expect((await getBoard(boardId)).status).toBe(200);
  });

  it('content with no creation stamp is a board, through the update-log half of the rule', async () => {
    const boardId = newBoardId();
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 1, y: 1 });
    await seedFromInside(boardId, Y.encodeStateAsUpdate(doc));

    // A real edit on a board that exists because of its content, not because of a
    // stamp: the row it writes is an `updates` row.
    const client = await TestClient.connect(boardId, { create: false });
    await client.waitForSync();
    createSticky(client.doc, { x: 9, y: 9 });
    await waitUntil('the edit is in the update log', async () => (await rowCount(boardId, 'updates')) > 0);
    client.close();

    // Take the other half of the rule away: what is left is one update row and no
    // stamp, which is exactly a board written before story 5.
    await sql(boardId, `DELETE FROM snapshot_chunks`);
    await sql(boardId, `DELETE FROM storage_meta WHERE key = ?`, ['created_at']);
    expect(await rowCount(boardId, 'snapshot_chunks')).toBe(0);
    expect(await metaValue(boardId, 'created_at')).toBeNull();
    expect(await rowCount(boardId, 'updates')).toBeGreaterThan(0);
    expect(await roomExists(boardId)).toBe(true);
    expect((await getBoard(boardId)).status).toBe(200);
  });

  it('a stamp with no content is a board', async () => {
    const boardId = await createBoardViaEndpoint();
    expect(await rowCount(boardId, 'updates')).toBe(0);
    expect(await rowCount(boardId, 'snapshot_chunks')).toBe(0);
    expect(await metaValue(boardId, 'created_at')).not.toBeNull();
    expect(await roomExists(boardId)).toBe(true);
  });

  // The rule is deliberately one-directional in time: once a board's own instance
  // has seen it exist, it stays existing, because nothing in this product deletes
  // a board. Un-creating a board is therefore not a case to assert - the case that
  // matters, and the one TC-06 and TC-15 assert, is a code that never had either
  // half to begin with.
});

// Two things that wait on the board's storage rather than on a socket, because
// what is being asserted is a row.
async function waitUntil(what: string, predicate: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}


