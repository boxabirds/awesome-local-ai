/**
 * Integration: the Worker's front door (TC-04 to TC-06, TC-13, TC-17).
 *
 * These run inside workerd against the real `fetch` handler, the real Durable
 * Object namespace and the real static assets — `SELF.fetch` is the only way to
 * ask "what does the deployed thing answer", and no part of it is mocked.
 *
 * `npm run build` has to have produced `dist/client` first, because the Worker
 * serves those assets.
 */

import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSticky } from '../../src/shared/board-model';
import { newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { joinAll, leaveAll, TestClient, waitForConvergence } from './helpers/ws-client';

/** Clients opened by a test, closed whatever the test did with them. */
let opened: TestClient[] = [];

afterEach(async () => {
  const clients = opened;
  opened = [];
  await leaveAll(clients);
});

describe('the board endpoint', () => {
  // TC-04 (negative)
  it('refuses a board id that is not an id, without reaching a room', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const bad = [
      'bad!id',
      'short',
      // Right length, and `+` is base64 rather than base64url.
      `${'A'.repeat(21)}+`,
      // An attempt at path traversal, percent-escaped so it survives to us.
      '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      ''
    ];
    for (const candidate of bad) {
      const response = await SELF.fetch(`https://vidi6.example/api/rooms/${candidate}`, {
        headers: { Upgrade: 'websocket' }
      });
      // Story 5 made this a 404 rather than story 3's 400: from behind a link, "that is
      // not an address" and "nobody made a board there" are one thing, and the client has
      // one page for it (`share.not_found`).
      expect(response.status, `${candidate} should be refused`).toBe(404);
      response.webSocket?.close();
    }
    // A refusal is a refusal: no board was looked up, so no room was woken.
    expect(idFromName).not.toHaveBeenCalled();
    idFromName.mockRestore();
  });

  // TC-05
  it('answers 426 when a valid board is asked for without an upgrade', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`https://vidi6.example/api/rooms/${boardId}`);
    expect(response.status).toBe(426);
  });

  // TC-06
  it('serves the app for /b/<boardId> so a shared link opens a board', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`https://vidi6.example/b/${boardId}`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('<div id="root"');
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  // TC-13 (boundary: the named capacity, plus one)
  it(`takes ${MAX_CONCURRENT_EDITORS + 1} editors on one board and syncs the last of them`, async () => {
    const boardId = newBoardId();
    const clients = await joinAll(boardId, MAX_CONCURRENT_EDITORS + 1);
    opened = clients;

    // Nobody is turned away at the door: capacity is a design target, not a limit.
    expect(clients).toHaveLength(MAX_CONCURRENT_EDITORS + 1);
    expect(clients.every((client) => client.synced)).toBe(true);

    // The one nobody asked for still collaborates like anybody else.
    const newcomer = clients[clients.length - 1];
    const noteId = createSticky(newcomer.doc, { x: 40, y: 60 });
    await TestClient.waitUntil(
      () => clients.every((client) => client.snapshot().some((note) => note.id === noteId)),
      5000,
      'every editor to see the new note'
    );
    await waitForConvergence(clients);
  });

  // TC-17 (negative: isolation)
  it('keeps one board out of another', async () => {
    const first = newBoardId();
    const second = newBoardId();
    expect(first).toMatch(BOARD_ID_PATTERN);
    expect(first).not.toBe(second);

    const [onFirst] = await joinAll(first, 1);
    const [onSecond] = await joinAll(second, 1);
    opened = [onFirst, onSecond];

    createSticky(onFirst.doc, { x: 10, y: 10 });
    createSticky(onFirst.doc, { x: 20, y: 20 });

    // The other board's client hears nothing at all — not a delayed update either.
    await expect(onSecond.waitForUpdates(1, 300)).rejects.toThrow(/timed out/);
    expect(onSecond.snapshot()).toEqual([]);
    expect(onFirst.snapshot()).toHaveLength(2);
  });
});
