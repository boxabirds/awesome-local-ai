import { describe, it, expect, vi } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import type { Env } from '../../src/worker/env';
import { newBoardId, isValidBoardId } from '@shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '@shared/config';
import { createSticky } from '@shared/board-model';
import { openRoomClient, waitFor, snapshotsMatch, YTestClient } from './helpers/ws-client';

const upgrade = { Upgrade: 'websocket', Connection: 'Upgrade' };

describe('sync.worker_entry — URL routing decides what handles a request', () => {
  it('TC-04: GET /api/rooms/bad!id with Upgrade → 404, and the room namespace is never touched', async () => {
    const idFromName = vi.spyOn((env as unknown as Env).BOARD_ROOM, 'idFromName');
    const res = await SELF.fetch('http://localhost/api/rooms/bad!id', { headers: upgrade });
    expect(res.status).toBe(404);
    expect(idFromName).not.toHaveBeenCalled();
    idFromName.mockRestore();
  });

  it('TC-05: a valid room path without a websocket upgrade → 426', async () => {
    const res = await SELF.fetch(`http://localhost/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(426);
  });

  it('TC-06: GET /b/<valid> serves the SPA index.html (assets fallback)', async () => {
    const res = await SELF.fetch(`http://localhost/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<div id="root"></div>');
  });

  it('TC-13: MAX_CONCURRENT_EDITORS + 1 sockets all connect; the last one’s note reaches every other', async () => {
    const board = newBoardId();
    const n = MAX_CONCURRENT_EDITORS + 1; // one over the soft cap — never refused
    const clients = await Promise.all(Array.from({ length: n }, () => openRoomClient(board)));
    expect(clients.every((c) => c.closed === null)).toBe(true);
    await waitFor(() => clients.every((c) => snapshotsMatch(c.snapshot(), clients[0].snapshot())), 4000);

    const last = clients[clients.length - 1];
    createSticky(last.doc, { x: 7, y: 7 });
    await waitFor(
      () => clients.slice(0, -1).every((c) => c.snapshot().length === 1),
      4000,
      'over-capacity joiner’s note did not reach all clients',
    );
    clients.forEach((c) => c.close());
  });

  it('TC-17: two rooms are isolated — a note in room 1 never appears in room 2', async () => {
    const room1 = newBoardId();
    const room2 = newBoardId();
    const a = await openRoomClient(room1);
    const b = await openRoomClient(room2);
    await new Promise((r) => setTimeout(r, 150));

    createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => a.snapshot().length === 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(b.snapshot().length).toBe(0); // room2 doc stayed empty
    a.close();
    b.close();
  });

  it('a valid upgrade opens a real, usable websocket that the room serves with sync', async () => {
    const board = newBoardId();
    // Initialize the board first (required since story 5)
    const doEnv = env as unknown as Env;
    const doId = doEnv.BOARD_ROOM.idFromName(board);
    const stub = doEnv.BOARD_ROOM.get(doId);
    await stub.initialize();
    const res = await SELF.fetch(`http://localhost/api/rooms/${board}`, { headers: upgrade });
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeTruthy();
    const client = new YTestClient(res.webSocket!);
    res.webSocket!.accept();
    await client.connect();
    await waitFor(() => client.received.some((m) => m.outer === 0)); // got a sync frame
    expect(isValidBoardId(board)).toBe(true);
    client.close();
  });
});
