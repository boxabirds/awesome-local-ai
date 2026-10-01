/// <reference types="vitest" />
// Story 5, worker.story5_share_link: the board API — create a board, and ask
// whether one exists — and the room's existence check, all against the real
// `env.BOARD_ROOM` namespace and a real Durable Object (the design's Test scope:
// the API over `env.BOARD_ROOM` with `@cloudflare/vitest-pool-workers`).
//
// The load-bearing assertion in several of these is the *absence* of storage: a
// link to a board that does not exist is opened all the time (a scanner, a link
// preview, a mistype), and doing so must leave nothing behind. That is checked by
// reading `sqlite_master` inside the object after the request — the only way to
// tell "this board has nothing" apart from "nothing was ever created for it".
import crypto from 'node:crypto';
import { SELF, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import {
  STATUS_METHOD_NOT_ALLOWED,
  STATUS_NOT_FOUND,
  STATUS_UPGRADE_REQUIRED,
} from '../../src/shared/protocol';
import { BOARDS_PATH, ROOM_PATH_PREFIX, boardPath, roomPath } from '../../src/shared/routes';
import type { BoardRoom } from '../../src/worker/board-room';
import { connectClient, roomStub, simulateRoomEviction } from './helpers/ws-client';

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const ofLength = (n: number): string =>
  Array.from({ length: n }, (_, i) => B64URL[(i * 7) % B64URL.length]).join('');

/** The tables this board's object has created, read from inside the object. An
 *  empty list means nothing was ever written — the whole point where it is used. */
async function tables(boardId: string): Promise<string[]> {
  return runInDurableObject(roomStub(boardId), (obj: unknown) =>
    (obj as unknown as { store: { sql: { exec(q: string): { toArray(): { name: string }[] } } } }).store.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .toArray()
      .map((row) => row.name)
      .filter((name) => !name.startsWith('sqlite_')),
  );
}

const createBoard = async (): Promise<string> => {
  const response = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

const existsStatus = (id: string): Promise<number> =>
  SELF.fetch(`http://localhost${BOARDS_PATH}/${id}`).then((r) => r.status);

const exists = async (id: string): Promise<boolean> => (await existsStatus(id)) === 200;

describe('TC-05: POST /api/boards creates a board', () => {
  it('answers 201 with a well-formed id the service then says exists', async () => {
    const response = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id?: string };
    expect(typeof body.id).toBe('string');
    expect(boardPath(body.id!)).toBe(`/b/${body.id}`);
    expect(await exists(body.id!)).toBe(true);
  });

  it('the created board has its tables and a created_at, and no update rows', async () => {
    const id = await createBoard();
    expect(await tables(id)).toEqual(expect.arrayContaining(['storage_meta', 'updates', 'snapshot_chunks']));
    const meta = await runInDurableObject(roomStub(id), (obj: unknown) =>
      (obj as unknown as { store: { sql: { exec(q: string): { toArray(): unknown[] } } } }).store.sql
        .exec("SELECT value FROM storage_meta WHERE key = 'created_at'")
        .toArray(),
    );
    expect(meta.length).toBe(1);
    const updates = await runInDurableObject(roomStub(id), (obj: unknown) =>
      (obj as unknown as { store: { sql: { exec(q: string): { toArray(): { n: number }[] } } } }).store.sql
        .exec('SELECT COUNT(*) AS n FROM updates')
        .toArray(),
    );
    expect(updates[0]!.n).toBe(0);
  });
});

describe('TC-06: a GET of an unknown id creates nothing', () => {
  it('a well-formed id the service never heard of is 404 with no tables', async () => {
    const id = newBoardId();
    expect(await tables(id)).toEqual([]); // clean slate
    expect((await SELF.fetch(`http://localhost${BOARDS_PATH}/${id}`)).status).toBe(STATUS_NOT_FOUND);
    expect(await tables(id)).toEqual([]); // the probe left nothing behind
  });

  it('a socket to an unknown id is 404 and also creates nothing', async () => {
    const id = newBoardId();
    const response = await SELF.fetch(`http://localhost${roomPath(id)}`, { headers: { upgrade: 'websocket' } });
    expect(response.status).toBe(STATUS_NOT_FOUND);
    expect(await tables(id)).toEqual([]);
  });
});

describe('TC-07: a malformed id is 404 on both endpoints, without touching the namespace', () => {
  const malformed = ['short', ofLength(23), ofLength(21), '../x', 'a'.repeat(21) + '+', 'A'.repeat(21) + '='];

  it.each(malformed)('existence of %p is 404', async (id) => {
    expect((await SELF.fetch(`http://localhost${BOARDS_PATH}/${encodeURIComponent(id)}`)).status).toBe(
      STATUS_NOT_FOUND,
    );
  });

  it.each(malformed)('a socket to %p is 404', async (id) => {
    // Encoded so a traversal id stays inside the room path rather than being
    // normalised out of it by the URL parser, and so never reaches the assets.
    expect(
      (await SELF.fetch(`http://localhost${ROOM_PATH_PREFIX}${encodeURIComponent(id)}`, { headers: { upgrade: 'websocket' } })).status,
    ).toBe(STATUS_NOT_FOUND);
  });

  it.each(malformed)('both endpoints answer a malformed id identically', async (id) => {
    // Existence and the room route give the same 404 with the same body, so a
    // probe learns nothing more from one endpoint than the other (share.not_found).
    const existence = await SELF.fetch(`http://localhost${BOARDS_PATH}/${encodeURIComponent(id)}`);
    const room = await SELF.fetch(`http://localhost${ROOM_PATH_PREFIX}${encodeURIComponent(id)}`, {
      headers: { upgrade: 'websocket' },
    });
    expect(existence.status).toBe(STATUS_NOT_FOUND);
    expect(room.status).toBe(STATUS_NOT_FOUND);
    expect(await room.text()).toBe(await existence.text());
  });
});

describe('TC-08: existence distinguishes created, known and unknown', () => {
  it('a created board is 200; after a client leaves it is still 200; a fresh id is 404', async () => {
    const id = await createBoard();
    expect(await exists(id)).toBe(true);
    const client = await connectClient(id, 'Ada');
    expect(client.isOpen).toBe(true);
    client.close();
    expect(await exists(id)).toBe(true);
    expect(await exists(newBoardId())).toBe(false);
  });

  it('a board survives a socket loss and eviction and still answers 200', async () => {
    const id = await createBoard();
    const client = await connectClient(id, 'Ada');
    await simulateRoomEviction(id);
    expect(client.isOpen).toBe(false);
    const again = await connectClient(id, 'Ada again');
    expect(again.isOpen).toBe(true);
    expect(await exists(id)).toBe(true);
    again.close();
  });
});

describe('TC-09: a WebSocket upgrade to an unknown id is 404 before any socket', () => {
  it('answers 404, opens no socket, leaves no tables', async () => {
    const id = newBoardId();
    const response = await SELF.fetch(`http://localhost${roomPath(id)}`, { headers: { upgrade: 'websocket' } });
    expect(response.status).toBe(STATUS_NOT_FOUND);
    expect(response.webSocket).toBeFalsy(); // a body, not an upgrade
    expect(await tables(id)).toEqual([]);
  });

  it('a well-formed but never-created id gives the same 404 as a malformed one', async () => {
    const unknown = await SELF.fetch(`http://localhost${roomPath(newBoardId())}`, { headers: { upgrade: 'websocket' } });
    const malformed = await SELF.fetch(`http://localhost${roomPath('not-an-id')}`, { headers: { upgrade: 'websocket' } });
    expect(unknown.status).toBe(STATUS_NOT_FOUND);
    expect(malformed.status).toBe(STATUS_NOT_FOUND);
    expect(await unknown.text()).toBe(await malformed.text());
  });
});

describe('TC-10: the room route still refuses a non-upgrade with 426', () => {
  it('answers 426 to a GET with no upgrade header', async () => {
    expect((await SELF.fetch(`http://localhost${roomPath(newBoardId())}`)).status).toBe(STATUS_UPGRADE_REQUIRED);
  });

  it('answers 426 for an existing board too (existence is not consulted first)', async () => {
    const id = await createBoard();
    expect((await SELF.fetch(`http://localhost${roomPath(id)}`)).status).toBe(STATUS_UPGRADE_REQUIRED);
  });

  it('a made-up well-formed id is 404 on upgrade and 426 without one', async () => {
    const id = crypto.randomBytes(16).toString('base64url');
    expect((await SELF.fetch(`http://localhost${roomPath(id)}`, { headers: { upgrade: 'websocket' } })).status).toBe(
      STATUS_NOT_FOUND,
    );
    expect((await SELF.fetch(`http://localhost${roomPath(id)}`)).status).toBe(STATUS_UPGRADE_REQUIRED);
  });
});

describe('TC-12: a real connection to a created board works; a fresh id is 404', () => {
  it('opens a working socket that syncs a real note', async () => {
    const id = await createBoard();
    const first = await connectClient(id, 'Ada');
    const note = first.createNote({ x: 0, y: 0 });
    first.setText(note, 'hello');
    const second = await connectClient(id, 'Bo');
    expect(second.noteTexts()).toContain('hello');
  });

  it('a socket to a fresh never-created id is 404', async () => {
    const response = await SELF.fetch(`http://localhost${roomPath(newBoardId())}`, { headers: { upgrade: 'websocket' } });
    expect(response.status).toBe(STATUS_NOT_FOUND);
  });
});

describe('TC-14: the board collection only takes POST', () => {
  it.each(['GET', 'PUT', 'DELETE', 'PATCH'] as const)('%s /api/boards is 405', async (method) => {
    expect((await SELF.fetch('http://localhost/api/boards', { method })).status).toBe(STATUS_METHOD_NOT_ALLOWED);
  });

  it('the created id appears in boardPath, roomPath and the existence path alike', async () => {
    const id = await createBoard();
    expect(boardPath(id)).toBe(`/b/${id}`);
    expect(roomPath(id)).toBe(`/api/rooms/${id}`);
    expect(`${BOARDS_PATH}/${id}`).toBe(`/api/boards/${id}`);
    expect((await SELF.fetch(`http://localhost${BOARDS_PATH}/${id}`)).status).toBe(200);
  });
});

describe('TC-15: initialize is idempotent', () => {
  it('first call creates, second says it existed, created_at does not move', async () => {
    const id = newBoardId();
    const stub = roomStub(id) as unknown as BoardRoom;
    expect(await stub.initialize()).toBe('created');
    const read = () =>
      runInDurableObject(roomStub(id), (obj: unknown) =>
        (obj as unknown as { store: { sql: { exec(q: string): { toArray(): unknown[] } } } }).store.sql
          .exec("SELECT value FROM storage_meta WHERE key = 'created_at'")
          .toArray(),
      );
    const before = await read();
    expect(await stub.initialize()).toBe('exists');
    expect(await read()).toEqual(before);
  });
});

describe('TC-32: an existing board connects with no creation step and no prompt', () => {
  it('joining a created board needs nothing but the address', async () => {
    // One browser creates it…
    const id = await createBoard();
    const author = await connectClient(id, 'Author');
    const note = author.createNote({ x: 5, y: 5 });
    author.setText(note, 'authored');

    // …another opens the same address and is straight in, editing what is there.
    const joiner = await connectClient(id, 'Joiner');
    expect(joiner.noteTexts()).toContain('authored');
    // With no further ceremony, the joiner edits the author's note.
    joiner.setText(joiner.noteIds()[0]!, 'authored edited');
    const reader = await connectClient(id, 'Reader');
    expect(reader.noteTexts()).toContain('authored edited');
  });
});
