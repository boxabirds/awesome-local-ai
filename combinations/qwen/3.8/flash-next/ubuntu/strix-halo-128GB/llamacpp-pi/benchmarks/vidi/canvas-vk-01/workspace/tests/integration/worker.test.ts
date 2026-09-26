import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import { BoardRoom } from '../../src/worker/board-room';
import { connectClient, waitUntil, type RoomClient } from './helpers/ws-client';

/**
 * sync.worker_entry integration (TC-04..TC-06, TC-13, TC-17): the real
 * Worker `fetch` handler, the real Durable Object namespace, no mocks.
 */

/** Wrap `BoardRoom.prototype.fetch` so stub calls can be counted. */
function spyRoomFetch(): { calls: string[]; restore(): void } {
  const proto = BoardRoom.prototype as unknown as {
    fetch(request: Request): Promise<Response>;
  };
  const original = proto.fetch;
  const calls: string[] = [];
  proto.fetch = async function (this: unknown, request: Request) {
    calls.push(request.url);
    return original.call(this, request);
  };
  return {
    calls,
    restore() {
      proto.fetch = original;
    },
  };
}

describe('worker routing', () => {
  it('TC-04: rejects an invalid board id with 404 and never creates an object', async () => {
    const spy = spyRoomFetch();
    try {
      const response = await SELF.fetch('http://worker.local/api/rooms/bad!id', {
        headers: { Upgrade: 'websocket' },
      });
      expect(response.status).toBe(404);
      expect(spy.calls).toHaveLength(0);
    } finally {
      spy.restore();
    }
  });

  it('TC-05: valid id without an Upgrade header gets 426', async () => {
    const response = await SELF.fetch(`http://worker.local/api/rooms/${newBoardId()}`);
    expect(response.status).toBe(426);
  });

  it('TC-06: /b/<valid id> serves index.html through the SPA fallback', async () => {
    const response = await SELF.fetch(`http://worker.local/b/${newBoardId()}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('<div id="root">');
  });
});

describe('capacity and isolation', () => {
  it(`TC-13: ${MAX_CONCURRENT_EDITORS} + 1 participants all connect; the last one's note reaches everyone`, async () => {
    const boardId = newBoardId();
    const count = MAX_CONCURRENT_EDITORS + 1;
    const clients: RoomClient[] = [];
    try {
      for (let i = 0; i < count; i += 1) {
        // `connectClient` throws unless the response was 101, so this asserts
        // every participant (including the over-capacity one) was accepted.
        clients.push(await connectClient(boardId));
      }
      const last = clients[clients.length - 1];
      const id = createSticky(last.doc, { x: 10, y: 20 });
      await waitUntil(
        () => clients.every((client) => client.board().some((note) => note.id === id)),
        'the note created by the over-capacity participant did not reach everyone',
      );
    } finally {
      for (const client of clients) client.close();
    }
  });

  it('TC-17: updates never cross boards', async () => {
    const room1 = newBoardId();
    const room2 = newBoardId();
    const a = await connectClient(room1);
    const b = await connectClient(room2);
    try {
      const id = createSticky(a.doc, { x: 0, y: 0 });
      await waitUntil(() => a.board().some((note) => note.id === id));
      // Give any hypothetical cross-delivery a chance to arrive.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(b.board()).toHaveLength(0);
      expect(b.log.filter((entry) => entry.kind === 'sync' && entry.syncType === 2)).toHaveLength(0);
    } finally {
      a.close();
      b.close();
    }
  });
});
