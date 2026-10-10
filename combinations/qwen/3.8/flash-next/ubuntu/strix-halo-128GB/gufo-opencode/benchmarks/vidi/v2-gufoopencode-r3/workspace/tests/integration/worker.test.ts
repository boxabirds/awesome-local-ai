/// <reference types="@cloudflare/vitest-pool-workers" />
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createSticky } from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { RoomClient, connectBoard, waitFor } from './ws-client';
import type { Env } from '../../src/worker/index';

describe('Worker entry routing (TC-04..TC-06)', () => {
  // TC-04 (negative): an invalid id gets 400 and never creates an object.
  it('TC-04 rejects invalid board ids with 400 without touching the namespace', async () => {
    const namespace = (env as unknown as Env).BOARD_ROOM;
    const original = namespace.idFromName.bind(namespace);
    let calls = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (namespace as any).idFromName = (name: string) => {
      calls += 1;
      return original(name);
    };
    try {
      const response = await SELF.fetch('https://example.com/api/rooms/bad!id', {
        headers: { Upgrade: 'websocket' }
      });
      expect(response.status).toBe(400);
      expect(calls).toBe(0);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (namespace as any).idFromName = original;
    }
  });

  // TC-05: a valid id without the Upgrade header gets 426.
  it('TC-05 requires a websocket upgrade', async () => {
    const response = await SELF.fetch(
      `https://example.com/api/rooms/${newBoardId()}`
    );
    expect(response.status).toBe(426);
  });

  // TC-06: everything else falls through to the static assets (SPA).
  it('TC-06 serves index.html for /b/<valid> via the SPA fallback', async () => {
    const response = await SELF.fetch(
      `https://example.com/b/${newBoardId()}`
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('id="root"');
  });
});

describe('BoardRoom acceptance and isolation (TC-13, TC-17)', () => {
  // TC-13 (negative): a 6th participant on a 5-capacity setting is not
  // refused and their edits reach everyone. Boundary from the named setting.
  it('TC-13 accepts MAX_CONCURRENT_EDITORS + 1 connections and relays edits', async () => {
    const boardId = newBoardId();
    const participants = MAX_CONCURRENT_EDITORS + 1;
    const clients: RoomClient[] = [];
    for (let i = 0; i < participants; i += 1) {
      clients.push(await connectBoard(SELF.fetch.bind(SELF), boardId));
    }
    const latecomer = clients[participants - 1];
    const id = createSticky(latecomer.doc, { x: 40, y: 40 });
    await waitFor(() =>
      clients.every((client) => client.snapshot().some((note) => note.id === id))
    );
    expect(clients).toHaveLength(participants);
    for (const client of clients) client.closeNow();
  });

  // TC-17 (negative): updates must not cross boards.
  it('TC-17 keeps boards separate', async () => {
    const board1 = newBoardId();
    const board2 = newBoardId();
    const client1 = await connectBoard(SELF.fetch.bind(SELF), board1);
    const client2 = await connectBoard(SELF.fetch.bind(SELF), board2);

    const frameIndex = client2.frames.length;
    let updatesOnBoard2 = 0;
    client2.doc.on('update', (_update, origin) => {
      if (origin === 'remote') updatesOnBoard2 += 1;
    });
    createSticky(client1.doc, { x: 10, y: 10 });
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(updatesOnBoard2).toBe(0);
    expect(client2.newFramesSince(frameIndex)).toHaveLength(0);
    expect(client2.snapshot()).toHaveLength(0);

    client1.closeNow();
    client2.closeNow();
  });
});
