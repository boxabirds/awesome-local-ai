import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import worker, { type Env } from '../../src/worker/index';
import { ORIGIN, docJson, eventually, join, upgrade } from './ws-client';

const HTTP_OK = 200;
const HTTP_SWITCHING_PROTOCOLS = 101;
const HTTP_BAD_REQUEST = 400;
const HTTP_UPGRADE_REQUIRED = 426;
const NOTE_AT = { x: 10, y: 20 } as const;

describe('sync.worker_entry routing', () => {
  it('TC-04 invalid board id → 400 and no Durable Object is addressed', async () => {
    const res = await upgrade('bad!id');
    expect(res.status).toBe(HTTP_BAD_REQUEST);

    // Same handler with a spying namespace: validation happens before any stub exists.
    const idFromName = vi.fn();
    const get = vi.fn();
    const spyEnv = { ...env, BOARD_ROOM: { idFromName, get } } as unknown as Env;
    const direct = await worker.fetch(
      new Request(`${ORIGIN}/api/rooms/bad!id`, { headers: { Upgrade: 'websocket' } }),
      spyEnv,
    );
    expect(direct.status).toBe(HTTP_BAD_REQUEST);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('TC-05 valid id without an Upgrade header → 426', async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/api/rooms/${newBoardId()}`), env);
    expect(res.status).toBe(HTTP_UPGRADE_REQUIRED);
  });

  it('TC-06 GET /b/<valid> → 200 index.html (SPA fallback)', async () => {
    const res = await worker.fetch(
      new Request(`${ORIGIN}/b/${newBoardId()}`, { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } }),
      env,
    );
    expect(res.status).toBe(HTTP_OK);
    const html = await res.text();
    expect(html).toContain('<div id="root"></div>');
  });

  it('TC-13 MAX_CONCURRENT_EDITORS + 1 sockets are all accepted and all receive a note', async () => {
    const boardId = newBoardId();
    const participants = MAX_CONCURRENT_EDITORS + 1;
    const statuses: number[] = [];
    const clients = [];
    for (let i = 0; i < participants; i += 1) {
      const res = await upgrade(boardId);
      statuses.push(res.status);
      res.webSocket?.accept();
      res.webSocket?.close();
      clients.push(await join(boardId));
    }
    expect(statuses).toEqual(Array(participants).fill(HTTP_SWITCHING_PROTOCOLS));

    const last = clients[clients.length - 1]!;
    createSticky(last.doc, NOTE_AT);
    for (const c of clients) {
      await eventually(() => expect(snapshot(c.doc)).toHaveLength(1));
      expect(docJson(c.doc)).toEqual(docJson(last.doc));
    }
    clients.forEach((c) => c.close());
  });

  it('TC-17 boards stay separate', async () => {
    const room1 = newBoardId();
    const room2 = newBoardId();
    const a = await join(room1);
    const b = await join(room2);
    createSticky(a.doc, NOTE_AT);
    // A's own round trip proves the room processed the update; B's proves B's room is idle.
    await a.barrier();
    await b.barrier();
    expect(b.updateCount()).toBe(0);
    expect(snapshot(b.doc)).toHaveLength(0);

    // A late joiner on B's board (the room's view) is empty too.
    const c = await join(room2, new Y.Doc());
    expect(snapshot(c.doc)).toHaveLength(0);
    [a, b, c].forEach((x) => x.close());
  });
});
