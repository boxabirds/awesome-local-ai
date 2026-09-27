// Worker entry routing contract (spec: sync.worker_entry).
//
// These drive the real `fetch` handler from `src/worker/index.ts` with a mock
// `Env`, so the routing, status codes and "no object created" behaviour are
// tested deterministically. (The pool's test runtime exposes no `env` global,
// and `SELF.fetch` cannot be spied on for the DO namespace; the DO itself is
// exercised against the real runtime in `board-room.test.ts`.)

import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import type { Env } from '../../src/worker';
import { BoardRoom } from '../../src/worker';
import worker from '../../src/worker';

interface MockEnv {
  env: Env;
  idFromNameCalls: string[];
  doFetchCalls: string[];
  assetFetchCalls: string[];
}

function mockEnv(): MockEnv {
  const idFromNameCalls: string[] = [];
  const doFetchCalls: string[] = [];
  const assetFetchCalls: string[] = [];
  const env: Env = {
    BOARD_ROOM: {
      idFromName: (boardId: string) => {
        idFromNameCalls.push(boardId);
        return boardId;
      },
      get: (id: string) => ({
        fetch: (_req: Request) => {
          doFetchCalls.push(id);
          return Promise.resolve(new Response('do', { status: 200 }));
        },
      }),
    } as unknown as DurableObjectNamespace<BoardRoom>,
    ASSETS: {
      fetch: (req: Request) => {
        assetFetchCalls.push(new URL(req.url).pathname);
        return Promise.resolve(
          new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
        );
      },
    } as unknown as Fetcher,
  };
  return { env, idFromNameCalls, doFetchCalls, assetFetchCalls };
}

function request(path: string, upgrade = false): Request {
  const headers = new Headers();
  if (upgrade) {
    headers.set('Upgrade', 'websocket');
    headers.set('Connection', 'Upgrade');
  }
  return new Request(`http://localhost${path}`, { headers });
}

describe('worker entry routing', () => {
  it('TC-04: invalid board id → 400 and no Durable Object is instantiated', async () => {
    const { env, idFromNameCalls } = mockEnv();
    const res = await worker.fetch(request('/api/rooms/bad!id', true), env);
    expect(res.status).toBe(400);
    expect(idFromNameCalls).toEqual([]);
  });

  it('TC-04b: id that is too long is rejected the same way', async () => {
    const { env, idFromNameCalls } = mockEnv();
    const tooLong = 'a'.repeat(64);
    const res = await worker.fetch(request(`/api/rooms/${tooLong}`, true), env);
    expect(res.status).toBe(400);
    expect(idFromNameCalls).toEqual([]);
  });

  it('TC-05: valid id without Upgrade header → 426', async () => {
    const { env } = mockEnv();
    const res = await worker.fetch(request(`/api/rooms/${newBoardId()}`), env);
    expect(res.status).toBe(426);
  });

  it('TC-05b: valid id with Upgrade header is forwarded to the object', async () => {
    const { env, doFetchCalls } = mockEnv();
    const boardId = newBoardId();
    const res = await worker.fetch(request(`/api/rooms/${boardId}`, true), env);
    expect(res.status).toBe(200); // from the stub object
    expect(doFetchCalls).toEqual([boardId]);
  });

  it('TC-06: /b/:boardId falls through to the static assets', async () => {
    const { env, assetFetchCalls } = mockEnv();
    const boardId = newBoardId();
    const res = await worker.fetch(request(`/b/${boardId}`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(await res.text()).toContain('id="root"');
    expect(assetFetchCalls).toEqual([`/b/${boardId}`]);
  });
});
