/**
 * share.board_api against the real Worker, the real BoardRoom Durable Object (RPC) and its real
 * SQLite storage (story 5, TC-05 to TC-15 and TC-32).
 *
 * Rate limiter: the local runtime (Miniflare, via @cloudflare/vitest-pool-workers) implements
 * the `ratelimits` binding from wrangler.jsonc, so TC-13 uses the REAL BOARD_CREATE_LIMITER
 * binding. Every test uses its own random CF-Connecting-IP so tests do not share a budget.
 */
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { BOARD_CREATE_LIMIT } from '../../src/shared/config';
import type { BoardRoom } from '../../src/worker/board-room';
import { META_CREATED_AT } from '../../src/worker/board-store';
import { createBoard } from '../../src/worker/create-board';
import worker, { type Env } from '../../src/worker/index';
import { RETRO_NOTES, retroLog } from '../fixtures/boards';
import { inRoom, meta, restartRoom, roomStub, tableNames, writeLog } from './storage';
import { ORIGIN, docJson, eventually, join, upgrade } from './ws-client';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_SWITCHING_PROTOCOLS = 101;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_ERROR = 500;
const IP_OCTET = 256;
const NOTE_AT = { x: 40, y: 40 } as const;

/** A distinct simulated visitor per call. */
function visitorIp(): string {
  const octet = () => Math.floor(Math.random() * IP_OCTET);
  return `10.${octet()}.${octet()}.${octet()}`;
}

function post(ip: string = visitorIp()): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/boards`, { method: 'POST', headers: { 'CF-Connecting-IP': ip } });
}

function check(id: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/boards/${id}`);
}

async function createdId(res: Response): Promise<string> {
  expect(res.status).toBe(HTTP_CREATED);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** Tables in the board's SQLite database, without the runtime's own internal tables. */
function appTables(storage: DurableObjectStorage): string[] {
  return tableNames(storage).filter((name) => !name.startsWith('_cf_'));
}

function createdAt(boardId: string): Promise<string | undefined> {
  return inRoom(boardId, (storage) => meta(storage, META_CREATED_AT));
}

/** The real env with a namespace whose every use is recorded (proves no object is addressed). */
function spyingEnv(): { spyEnv: Env; idFromName: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } {
  const idFromName = vi.fn();
  const get = vi.fn();
  return { spyEnv: { ...env, BOARD_ROOM: { idFromName, get } } as unknown as Env, idFromName, get };
}

describe('share.board_api: create and check', () => {
  it('TC-05 POST → 201 id matching the pattern; GET 200; created_at stored', async () => {
    const before = Date.now();
    const id = await createdId(await post());
    expect(id).toMatch(BOARD_ID_PATTERN);
    const res = await check(id);
    expect(res.status).toBe(HTTP_OK);
    expect(await res.json()).toEqual({ id });
    const stored = Number(await createdAt(id));
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(Date.now());
  });

  it('TC-06 GET a never-created id → 404 and no storage is written', async () => {
    const id = newBoardId();
    const res = await check(id);
    expect(res.status).toBe(HTTP_NOT_FOUND);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(await inRoom(id, (storage) => appTables(storage))).toEqual([]);
  });

  it('TC-07 malformed ids → 404 without any RPC', async () => {
    const tooLong = `${newBoardId()}A`;
    const tooShort = newBoardId().slice(1);
    for (const bad of ['abc', tooLong, tooShort]) {
      const res = await check(bad);
      expect(res.status, bad).toBe(HTTP_NOT_FOUND);
      expect(await res.json()).toEqual({ error: 'not_found' });

      const { spyEnv, idFromName, get } = spyingEnv();
      const direct = await worker.fetch(new Request(`${ORIGIN}/api/boards/${bad}`), spyEnv);
      expect(direct.status).toBe(HTTP_NOT_FOUND);
      expect(idFromName).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    }
    // A path segment containing '/' is not an id either.
    expect((await check(`${newBoardId()}/x`)).status).toBe(HTTP_NOT_FOUND);
  });

  it('TC-08 legacy board (log rows, no created_at) → GET 200 and it opens with its content', async () => {
    const id = newBoardId();
    const log = retroLog();
    await inRoom(id, (storage) => {
      writeLog(storage, log.updates);
      expect(meta(storage, META_CREATED_AT)).toBeUndefined();
    });
    await restartRoom(id);
    expect((await check(id)).status).toBe(HTTP_OK);
    const client = await join(id);
    expect(snapshot(client.doc)).toHaveLength(RETRO_NOTES);
    client.close();
    // Opening it did not turn it into a "new" board.
    expect(await createdAt(id)).toBeUndefined();
  });
});

describe('share.board_api: WebSocket rooms', () => {
  it('TC-09 upgrade to an unknown id → 404, no socket, no tables', async () => {
    const id = newBoardId();
    const res = await upgrade(id);
    expect(res.status).toBe(HTTP_NOT_FOUND);
    expect(res.webSocket).toBeNull();
    expect(await inRoom(id, (storage) => appTables(storage))).toEqual([]);
    expect(await inRoom(id, (_storage, _room, state) => state.getWebSockets().length)).toBe(0);
  });

  it('TC-09 upgrade to a malformed id → 404', async () => {
    expect((await upgrade('abc')).status).toBe(HTTP_NOT_FOUND);
  });

  it('TC-10 upgrade after POST → 101 and story 3 sync works', async () => {
    const id = await createdId(await post());
    const res = await upgrade(id);
    expect(res.status).toBe(HTTP_SWITCHING_PROTOCOLS);
    res.webSocket?.accept();
    res.webSocket?.close();

    const a = await join(id);
    const b = await join(id);
    const noteId = createSticky(a.doc, NOTE_AT);
    await eventually(() => expect(snapshot(b.doc).map((n) => n.id)).toEqual([noteId]));
    expect(docJson(b.doc)).toEqual(docJson(a.doc));
    a.close();
    b.close();
  });
});

describe('share.board_api: collisions and failures', () => {
  it('TC-11 a generated id that is already a board is skipped; the fresh one is created', async () => {
    const existing = await createdId(await post());
    const existingCreatedAt = await createdAt(existing);
    const fresh = newBoardId();
    const ids = [existing, fresh];
    const generate = vi.fn(() => ids.shift()!);

    const result = await createBoard(env, visitorIp(), { generate });
    expect(result).toEqual({ ok: true, id: fresh });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await createdAt(existing)).toBe(existingCreatedAt);
    expect((await check(fresh)).status).toBe(HTTP_OK);
  });

  it('TC-11 a legacy board id is never handed out as new', async () => {
    const legacy = newBoardId();
    await inRoom(legacy, (storage) => {
      writeLog(storage, retroLog().updates.slice(0, 1));
    });
    expect(await roomStub(legacy).initialize()).toBe('exists');
    expect(await createdAt(legacy)).toBeUndefined();
  });

  it('TC-12 initialize throws → 500 create_failed', async () => {
    const initialize = vi.fn(() => Promise.reject(new Error('RPC failed')));
    const failingEnv = {
      ...env,
      BOARD_ROOM: {
        idFromName: (name: string) => env.BOARD_ROOM.idFromName(name),
        get: () => ({ initialize }),
      },
    } as unknown as Env;
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/boards`, { method: 'POST', headers: { 'CF-Connecting-IP': visitorIp() } }),
      failingEnv,
    );
    expect(res.status).toBe(HTTP_INTERNAL_ERROR);
    expect(await res.json()).toEqual({ error: 'create_failed' });
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('TC-12 collisions exhausted → create_failed', async () => {
    const existing = await createdId(await post());
    const result = await createBoard(env, visitorIp(), { generate: () => existing });
    expect(result).toEqual({ ok: false, reason: 'create_failed' });
  });
});

describe('share.board_api: limits and methods', () => {
  it(`TC-13 ${BOARD_CREATE_LIMIT} creations allowed, the next rejected; another visitor unaffected`, async () => {
    const ip = visitorIp();
    for (let i = 0; i < BOARD_CREATE_LIMIT; i += 1) {
      expect((await post(ip)).status, `creation ${i + 1}`).toBe(HTTP_CREATED);
    }
    const limited = await post(ip);
    expect(limited.status).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect((await post(visitorIp())).status).toBe(HTTP_CREATED);
  });

  it('TC-13 a rate-limited request creates no board', async () => {
    const initialize = vi.fn();
    const limitedEnv = {
      ...env,
      BOARD_CREATE_LIMITER: { limit: async () => ({ success: false }) },
      BOARD_ROOM: { idFromName: vi.fn(), get: () => ({ initialize }) },
    } as unknown as Env;
    const res = await worker.fetch(new Request(`${ORIGIN}/api/boards`, { method: 'POST' }), limitedEnv);
    expect(res.status).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(initialize).not.toHaveBeenCalled();
  });

  it('TC-14 other methods on /api/boards → 405', async () => {
    for (const method of ['PUT', 'GET', 'DELETE']) {
      const res = await SELF.fetch(`${ORIGIN}/api/boards`, { method });
      expect(res.status, method).toBe(HTTP_METHOD_NOT_ALLOWED);
    }
    const id = await createdId(await post());
    expect((await SELF.fetch(`${ORIGIN}/api/boards/${id}`, { method: 'PUT' })).status).toBe(HTTP_METHOD_NOT_ALLOWED);
  });

  it('TC-15 initialize() twice → created then exists; created_at unchanged', async () => {
    const id = newBoardId();
    const results = await runInDurableObject(roomStub(id), (room: BoardRoom) => {
      const first = room.initialize();
      const firstAt = meta(roomStorage(room), META_CREATED_AT);
      const second = room.initialize();
      return { first, second, firstAt, secondAt: meta(roomStorage(room), META_CREATED_AT) };
    });
    expect(results.first).toBe('created');
    expect(results.second).toBe('exists');
    expect(results.firstAt).toBeDefined();
    expect(results.secondAt).toBe(results.firstAt);
    // And over RPC, as the Worker calls it.
    expect(await roomStub(id).initialize()).toBe('exists');
    expect(await createdAt(id)).toBe(results.firstAt);
  });
});

/** The storage of a room instance (runInDurableObject hands us the instance). */
function roomStorage(room: BoardRoom): DurableObjectStorage {
  return (room as unknown as { ctx: DurableObjectState }).ctx.storage;
}

describe('share privacy', () => {
  it('TC-32 served index.html asks the browser not to send board links as Referer', async () => {
    const res = await SELF.fetch(`${ORIGIN}/b/${newBoardId()}`, {
      headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' },
    });
    expect(res.status).toBe(HTTP_OK);
    expect(await res.text()).toContain('<meta name="referrer" content="no-referrer" />');
  });
});
