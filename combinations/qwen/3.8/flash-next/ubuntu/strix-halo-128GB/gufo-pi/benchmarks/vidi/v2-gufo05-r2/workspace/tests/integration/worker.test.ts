/**
 * sync.worker_entry, integration: the real Worker `fetch` handler in workerd,
 * with the real `wrangler.jsonc` (Durable Object binding + assets SPA fallback).
 *
 * TC-04 invalid id → 400 and the Durable Object is never touched;
 * TC-05 valid id without `Upgrade` → 426; TC-06 `/b/:boardId` serves the client.
 *
 * The tests that need an open WebSocket (TC-13 capacity, TC-17 isolation) are in
 * `board-room.test.ts`, which runs against a real server.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import worker, { BoardRoom, type Env } from '../../src/worker/index';
import { newBoardId } from '../../src/shared/board-id';

/**
 * The `env` the pool hands out is typed by generated Cloudflare types that are
 * not committed; the Worker's own `Env` is the source of truth here.
 */
const workerEnv = env as unknown as Env;

/** A BOARD_ROOM namespace that records every `idFromName` call. */
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

describe('worker routing', () => {
  it('TC-04: rejects an invalid board id with 400 without touching the Durable Object', async () => {
    const calls: string[] = [];
    const spyEnv: Env = {
      BOARD_ROOM: spyingNamespace(workerEnv.BOARD_ROOM, calls),
      ASSETS: workerEnv.ASSETS,
    };

    const response = await worker.fetch(
      new Request('http://vidi6.test/api/rooms/bad!id', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      }),
      spyEnv,
    );

    expect(response.status).toBe(400);
    // No id lookup means no stub, which means no object instance was created.
    expect(calls).toEqual([]);
  });

  it('TC-04: every malformed id under /api/rooms/ is rejected', async () => {
    const paths = [
      '/api/rooms/',
      '/api/rooms/short',
      '/api/rooms/a!b',
      '/api/rooms/aaaaaaaaaaaaaaaaaaaaa', // 21 chars
      '/api/rooms/aaaaaaaaaaaaaaaaaaaaaaa', // 23 chars
    ];
    for (const path of paths) {
      const response = await SELF.fetch(`http://vidi6.test${path}`, {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      });
      expect(`${path} -> ${response.status}`).toBe(`${path} -> 400`);
    }
  });

  it('TC-05: a valid board id without an Upgrade header gets 426', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`http://vidi6.test/api/rooms/${boardId}`);
    expect(response.status).toBe(426);
  });

  it('TC-06: GET /b/<valid> serves the client (SPA fallback)', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`http://vidi6.test/b/${boardId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('<div id="root">');
  });
});
