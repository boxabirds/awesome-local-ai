/**
 * share.board_api, integration: the two board routes against the real Worker, the
 * real `BoardRoom` RPC and the real SQLite inside a Durable Object.
 *
 * TC-05  POST creates, and the id is a link code and exists;
 * TC-06  an unknown id is 404 and leaves no tables behind;
 * TC-07  a malformed id is 404 without naming a Durable Object at all;
 * TC-08  a board with content but no `created_at` still exists (share.legacy_boards);
 * TC-09  connecting to an unknown board is refused, and writes nothing;
 * TC-10  a created board accepts the connection;
 * TC-12  a failing initialize answers 500 with no id, and opens nothing;
 * TC-14  the only methods that exist here are the two that are defined;
 * TC-15  creating the same board twice does not create it twice;
 * TC-32  the page itself does not leak the link it came from.
 *
 * The sync that follows an accepted connection is story 3's, and is exercised over a
 * real server in `board-room.test.ts` (the pool cannot carry a WebSocket
 * conversation). What this file pins down is the door in front of it: who gets in,
 * and what asking costs.
 */

import * as Y from 'yjs';
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';
import worker, { BoardRoom, type Env } from '../../src/worker/index';

const workerEnv = env as unknown as Env;

const stubFor = (boardId: string): DurableObjectStub<BoardRoom> =>
  workerEnv.BOARD_ROOM.get(workerEnv.BOARD_ROOM.idFromName(boardId));

/** Every table this object has, read straight out of its own SQLite. */
function tables(boardId: string): Promise<string[]> {
  return runInDurableObject(stubFor(boardId), (_room, ctx) =>
    ctx.storage.sql
      .exec<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .toArray()
      .map((row) => row.name),
  );
}

function created_at(boardId: string): Promise<number | null> {
  return runInDurableObject(stubFor(boardId), (room) => room.store.createdAt());
}

/** A WebSocket upgrade request, as the browser's provider would send it. */
function upgradeRequest(url: string): Request {
  return new Request(url, {
    headers: {
      connection: 'upgrade',
      upgrade: 'websocket',
      'sec-websocket-key': 'sgcS27MuFnD0bHtW48VaUg==',
      host: 'vidi6.test',
    },
  });
}

async function createBoardThroughTheApi(): Promise<{ status: number; body: unknown }> {
  const response = await SELF.fetch('http://vidi6.test/api/boards', { method: 'POST' });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** A namespace that records the ids it was asked to name. */
function spyingNamespace(
  namespace: DurableObjectNamespace<BoardRoom>,
  calls: string[],
): DurableObjectNamespace<BoardRoom> {
  return new Proxy(namespace, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (property === 'idFromName') {
        return (name: string) => {
          calls.push(name);
          return target.idFromName(name);
        };
      }
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  }) as unknown as DurableObjectNamespace<BoardRoom>;
}

describe('POST /api/boards (TC-05, TC-12, TC-14)', () => {
  it('TC-05: creates a board at a link code, which then exists', async () => {
    const { status, body } = await createBoardThroughTheApi();
    expect(status).toBe(201);

    const id = (body as { id?: string }).id ?? '';
    expect(id).toMatch(BOARD_ID_PATTERN);
    expect(id).toHaveLength(22);
    expect(isValidBoardId(id)).toBe(true);

    // The same answer the client will get before it opens the board: 200, and the id
    // it was asked about.
    const check = await SELF.fetch(`http://vidi6.test/api/boards/${id}`);
    expect(check.status).toBe(200);
    expect(((await check.json()) as { id?: string }).id).toBe(id);

    // And it exists *in storage*, not just in this request: the stamp is what a
    // later process reads.
    expect(await created_at(id)).toBeTypeOf('number');
  });

  it('TC-05: nothing about a new board can be predicted from the last one', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { status, body } = await createBoardThroughTheApi();
      expect(status).toBe(201);
      ids.add((body as { id: string }).id);
    }
    expect(ids.size).toBe(20);
  });

  it('TC-12: a failing create answers 500 with the reason, no id, and nothing opened', async () => {
    // The injection is the Durable Object side failing, which is the only way
    // creation can fail: no object, no board.
    const throwingNamespace = {
      idFromName: (name: string) => ({ name }),
      get: () => {
        throw new Error('simulated: the namespace could not hand out an object');
      },
    } as unknown as DurableObjectNamespace<BoardRoom>;

    const response = await worker.fetch(
      new Request('http://vidi6.test/api/boards', { method: 'POST' }),
      { BOARD_ROOM: throwingNamespace, ASSETS: workerEnv.ASSETS, ASSETS_BUCKET: workerEnv.ASSETS_BUCKET } satisfies Env,
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string; id?: string };
    expect(body.error).toBe('create_failed');
    // No id: the home page has nothing to navigate to, so it cannot open a board
    // that was never made (share.create_failure).
    expect(body.id).toBeUndefined();
  });

  it('TC-12: an object that refuses the initialize RPC fails the same way', async () => {
    const rejectingNamespace = {
      idFromName: (name: string) => name,
      get: () => ({
        initialize: async () => {
          throw new Error('simulated: the board could not be started');
        },
      }),
    } as unknown as DurableObjectNamespace<BoardRoom>;

    const response = await worker.fetch(
      new Request('http://vidi6.test/api/boards', { method: 'POST' }),
      { BOARD_ROOM: rejectingNamespace, ASSETS: workerEnv.ASSETS, ASSETS_BUCKET: workerEnv.ASSETS_BUCKET } satisfies Env,
    );
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toBe('create_failed');
  });

  it('TC-14: any other method on the collection is 405', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
      const response = await SELF.fetch('http://vidi6.test/api/boards', { method });
      expect(`${method} -> ${response.status}`).toBe(`${method} -> 405`);
    }
  });

  it('TC-14: any other method on one board is 405, including DELETE', async () => {
    const { body } = await createBoardThroughTheApi();
    const id = (body as { id: string }).id;
    for (const method of ['PUT', 'PATCH', 'DELETE', 'POST', 'OPTIONS']) {
      const response = await SELF.fetch(`http://vidi6.test/api/boards/${id}`, { method });
      expect(`${method} -> ${response.status}`).toBe(`${method} -> 405`);
    }
    // The board is still there: no API call can remove a board (board.close).
    expect((await SELF.fetch(`http://vidi6.test/api/boards/${id}`)).status).toBe(200);
  });
});

describe('GET /api/boards/:id (TC-06, TC-07, TC-08)', () => {
  it('TC-06: an id nobody created is 404, and the object is left with no tables at all', async () => {
    const boardId = newBoardId();

    const response = await SELF.fetch(`http://vidi6.test/api/boards/${boardId}`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('not_found');

    // The point of `existsReadOnly`: the question was asked of a real object, and
    // asking wrote nothing whatever — not one table.
    expect(await tables(boardId)).toEqual([]);
  });

  it('TC-06: a board that only ever failed to load is still not a board', async () => {
    // The one thing that does get written by a read is a failed-load record (the
    // retry interval has to survive the room). It must not count as existence, or
    // probing would create boards after all.
    const boardId = newBoardId();
    await runInDurableObject(stubFor(boardId), (room) => room.store.recordLoadFailure(1, 'simulated'));

    expect((await SELF.fetch(`http://vidi6.test/api/boards/${boardId}`)).status).toBe(404);
    expect(await tables(boardId)).toEqual(['storage_meta']);
  });

  it('TC-07: an address that is not a link code is 404, and no object is named', async () => {
    const calls: string[] = [];
    const spyEnv: Env = {
      BOARD_ROOM: spyingNamespace(workerEnv.BOARD_ROOM, calls),
      ASSETS: workerEnv.ASSETS,
      ASSETS_BUCKET: workerEnv.ASSETS_BUCKET,
    };

    const unknown = newBoardId();
    const paths = [
      '/api/boards/',
      '/api/boardsfoo', // an /api path that is not one of ours is not a page either
      '/api/boards/abc',
      '/api/boards/aaaaaaaaaaaaaaaaaaaaaaa', // 23 characters
      '/api/boards/a!b',
      `/api/boards/${unknown}/notes`, // a path under a board's own address
    ];
    for (const path of paths) {
      const response = await worker.fetch(new Request(`http://vidi6.test${path}`), spyEnv);
      expect(`${path} -> ${response.status}`).toBe(`${path} -> 404`);
    }
    // Naming an object is what could have created one: none was named.
    expect(calls).toEqual([]);
  });

  it('TC-08: a board with a stored change and no created_at exists', async () => {
    const boardId = newBoardId();
    // The shape of a board made before story 5: tables and an update, no creation
    // stamp. Nobody may be locked out of work they already have (share.legacy_boards).
    await runInDurableObject(stubFor(boardId), (room) => {
      const doc = new Y.Doc();
      doc.getMap('objects').set('legacy', 'kept');
      room.store.migrate();
      room.store.append(Y.encodeStateAsUpdate(doc));
      return room.store.createdAt();
    });

    expect(await created_at(boardId)).toBeNull();
    expect((await SELF.fetch(`http://vidi6.test/api/boards/${boardId}`)).status).toBe(200);
  });

  it('TC-08: empty tables are not content, and are not a board', async () => {
    const boardId = newBoardId();
    await runInDurableObject(stubFor(boardId), (room) => {
      room.store.migrate();
    });

    // Tables with nothing in them and no stamp: nothing of anyone's is there to lose,
    // and no link was ever given out.
    expect((await SELF.fetch(`http://vidi6.test/api/boards/${boardId}`)).status).toBe(404);
  });
});

describe('the door in front of a room (TC-09, TC-10)', () => {
  it('TC-09: a socket aimed at an unknown board is refused and writes nothing', async () => {
    const boardId = newBoardId();

    const response = await SELF.fetch(upgradeRequest(`http://vidi6.test/api/rooms/${boardId}`));
    expect(response.status).toBe(404);
    expect(response.webSocket).toBeNull();

    // "Connecting is no longer a way to create": the refused connection left the
    // object exactly as it found it.
    expect(await tables(boardId)).toEqual([]);
    expect(await SELF.fetch(`http://vidi6.test/api/boards/${boardId}`).then((r) => r.status)).toBe(404);
  });

  it('TC-10: a board created through the API accepts the connection', async () => {
    const { body } = await createBoardThroughTheApi();
    const id = (body as { id: string }).id;

    const response = await SELF.fetch(upgradeRequest(`http://vidi6.test/api/rooms/${id}`));
    expect(response.status).toBe(101);

    // The room that took the socket is the room that owns this board, and it is the
    // one place a board's changes go (story 3): nothing new to prove here except that
    // the door opened.
    expect(await runInDurableObject(stubFor(id), (room) => room.roomState)).toBe('ready');
  });

  it('TC-10: joining does not create anything a second time', async () => {
    const { body } = await createBoardThroughTheApi();
    const id = (body as { id: string }).id;
    const stamp = await created_at(id);

    await SELF.fetch(upgradeRequest(`http://vidi6.test/api/rooms/${id}`));

    // Same board, same moment of creation, one set of tables: the connection joined
    // the board rather than starting one (share.not_found).
    expect(await created_at(id)).toBe(stamp);
    const status = await runInDurableObject(stubFor(id), (room) => room.store.summary());
    expect(status.schemaVersion).not.toBeNull();
    expect(status.updateCount).toBe(0);
  });
});

describe('creation is not a repeatable act (TC-15)', () => {
  it('TC-15: initializing the same board twice creates it once', async () => {
    const boardId = newBoardId();
    const room = stubFor(boardId);

    expect(await room.initialize()).toBe('created');
    const first = await created_at(boardId);
    expect(first).toBeTypeOf('number');

    // The second answer is `exists`, and it changes nothing: re-creating a board
    // would be overwriting one somebody is using.
    expect(await room.initialize()).toBe('exists');
    expect(await created_at(boardId)).toBe(first);

    // Which is why `POST /api/boards` can treat a taken id as a failure rather than
    // open a second board at an address that already has one.
    expect(await room.exists()).toBe(true);
  });

  it('TC-15: a board is created in its own object, and only in that one', async () => {
    const [a, b] = [newBoardId(), newBoardId()];
    expect(await stubFor(a).initialize()).toBe('created');

    expect(await stubFor(a).exists()).toBe(true);
    expect(await stubFor(b).exists()).toBe(false);
    expect(await tables(b)).toEqual([]);
  });
});

describe('the page that carries the link (TC-32)', () => {
  it('TC-32: the served page asks for no referrer', async () => {
    const response = await SELF.fetch('http://vidi6.test/');
    expect(response.status).toBe(200);
    const html = await response.text();
    // A board's link is its only access control; the referrer header would hand it
    // to wherever the person navigated next.
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
  });

  it('TC-32: and so does the fallback for a board address', async () => {
    const response = await SELF.fetch(`http://vidi6.test/b/${newBoardId()}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<meta name="referrer" content="no-referrer"');
  });
});
