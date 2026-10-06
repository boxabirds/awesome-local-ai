/**
 * Worker entry integration tests (TC-04 to TC-06, TC-13, TC-17).
 *
 * Everything here runs inside workerd against the real `fetch` handler, the real assets
 * handler and real Durable Objects: routing and status codes are request-handling facts, so
 * nothing is mocked.
 */
import { describe, expect, test } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import worker, { type Env } from '../../src/worker/index';
import { createSticky } from '../../src/shared/board-model';
import { closeAll, connect, converge, ensureBoard, sameState, SYNC_UPDATE, type RoomClient } from './ws-client';

/** The headers a browser sends when it asks for a WebSocket. */
function upgradeHeaders(): Record<string, string> {
  return {
    upgrade: 'websocket',
    connection: 'Upgrade',
    'sec-websocket-version': '13',
    'sec-websocket-key': 'dGVzdGluZy1rZXktMDEyMzQ1Njc4OTI=',
  };
}

/**
 * A namespace that records every `idFromName` call, so a test can prove a request never
 * reached - or did reach - the Durable Object layer.
 */
function spyingNamespace(real: Env['BOARD_ROOM'], calls: string[]): Env['BOARD_ROOM'] {
  return {
    idFromName: (name: string) => {
      calls.push(name);
      return real.idFromName(name);
    },
    get: (id: DurableObjectId) => real.get(id),
    newUniqueId: () => real.newUniqueId(),
  } as unknown as Env['BOARD_ROOM'];
}

describe('worker routing (TC-04 to TC-06)', () => {
  test('TC-04: an invalid board id is a 404 and never reaches a room instance', async () => {
    const calls: string[] = [];
    const spyEnv: Env = { ...env, BOARD_ROOM: spyingNamespace(env.BOARD_ROOM, calls) };

    const response = await worker.fetch(
      new Request('http://vidi6.local/api/rooms/bad!id', { headers: upgradeHeaders() }),
      spyEnv,
    );
    expect(response.status).toBe(404);
    // the negative half: no object id was derived, so no instance was ever created
    expect(calls).toEqual([]);

    // control: the same spy does record a routed request, so the assertion above means it
    const valid = newBoardId();
    await ensureBoard(valid);
    const ok = await worker.fetch(
      new Request(`http://vidi6.local/api/rooms/${valid}`, { headers: upgradeHeaders() }),
      spyEnv,
    );
    expect(ok.status).toBe(101);
    ok.webSocket?.accept(); // workerd wants the client half accepted before it is closed
    ok.webSocket?.close(1000, 'done');
    expect(calls).toEqual([valid]);
  });

  test('TC-05: a valid board id without an upgrade is 426 Upgrade Required', async () => {
    const response = await SELF.fetch(`http://vidi6.local/api/rooms/${newBoardId()}`);
    expect(response.status).toBe(426);
  });

  test('TC-06: GET /b/<boardId> serves index.html (SPA fallback)', async () => {
    const response = await SELF.fetch(`http://vidi6.local/b/${newBoardId()}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<div id="root">');
    expect(html).toContain('<script');
  });

  test('an API path that is not a room is a 404, not the SPA page', async () => {
    const response = await SELF.fetch('http://vidi6.local/api/nope');
    expect(response.status).toBe(404);
  });

  test('the client itself is served at the root', async () => {
    const response = await SELF.fetch('http://vidi6.local/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
  });
});

describe('capacity and isolation', () => {
  test('TC-13: a 6th participant on a board is connected and their edits reach everyone', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);
    const clients: RoomClient[] = [];
    try {
      for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i += 1) {
        const client = await connect(boardId);
        await client.waitForSync();
        clients.push(client);
      }
      // nobody is refused: every connection was accepted (101) and synced
      expect(clients).toHaveLength(MAX_CONCURRENT_EDITORS + 1);

      // and the last one to arrive edits like everybody else
      const latecomer = clients[clients.length - 1];
      if (!latecomer) throw new Error('no latecomer');
      createSticky(latecomer.doc, { x: 40, y: 40 });
      await converge(clients);
      expect(latecomer.notes()).toHaveLength(1);
      for (const client of clients) expect(client.notes()).toHaveLength(1);
    } finally {
      closeAll(clients);
    }
  });

  test('TC-17: two boards never see each other (live.isolation)', async () => {
    const id1 = newBoardId();
    const id2 = newBoardId();
    await ensureBoard(id1);
    await ensureBoard(id2);
    const first = await connect(id1);
    const second = await connect(id2);
    try {
      await first.waitForSync();
      await second.waitForSync();

      createSticky(first.doc, { x: 10, y: 10 });
      createSticky(first.doc, { x: 200, y: 10 });
      await first.waitForSync();
      // let anything that could leak across arrive before asserting it did not
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(first.notes()).toHaveLength(2);
      expect(second.notes()).toHaveLength(0);
      // room two never heard of those notes: no update crossed over, only the empty
      // handshake of a board of its own
      expect(second.frames.filter((f) => f.kind === 'sync' && f.syncType === SYNC_UPDATE)).toEqual(
        [],
      );
      expect(sameState([second])).toBe(true);
    } finally {
      closeAll([first, second]);
    }
  });
});
