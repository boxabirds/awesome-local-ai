import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  BASE_URL,
  boardsAgree,
  closeAll,
  connectClient,
  connectedClient,
  requestRoom,
  waitFor,
  type SyncClient,
} from './helpers/sync-client';

/**
 * Worker entry (`sync.worker_entry`, design TC-04, TC-05, TC-06, TC-13, TC-17).
 *
 * The route decides which board a socket belongs to, so it is also where an
 * address that is not a board id has to stop, where a non-WebSocket request is
 * refused, and where everything that is not a room falls through to the static
 * client.
 */

describe('board id routing (TC-04)', () => {
  it('answers 400 for a malformed id and never reaches a room instance', async () => {
    const malformed = [
      'bad!id',
      '',
      'nope',
      `${newBoardId()}x`,
      'foo+bar123456789012345',
      // Encoded traversal: the path must not climb out of /api/rooms/.
      'board%2F..%2Fother',
      '..%2Fother',
    ];
    for (const boardId of malformed) {
      const response = await requestRoom(boardId);
      expect(response.status, `board id ${JSON.stringify(boardId)}`).toBe(400);
      // The room's own fetch always upgrades: no upgrade means no object ran.
      expect(response.webSocket, `board id ${JSON.stringify(boardId)}`).toBeFalsy();
      await response.body?.cancel();
    }
  });

  it('upgrades a valid id', async () => {
    const boardId = newBoardId();
    const response = await requestRoom(boardId);
    expect(response.status).toBe(101);
    const webSocket = response.webSocket;
    expect(webSocket).toBeTruthy();
    webSocket?.accept();
    webSocket?.close();
  });

  it('answers 400 rather than static HTML for a room path with a bad id', async () => {
    const response = await requestRoom('definitely-not-a-board-id', { upgrade: false });
    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type') ?? '').not.toContain('text/html');
    await response.body?.cancel();
  });
});

describe('non-WebSocket requests to a room route (TC-05)', () => {
  it('answers 426 when there is no Upgrade header', async () => {
    const boardId = newBoardId();
    const response = await requestRoom(boardId, { upgrade: false });
    expect(response.status).toBe(426);
    expect(response.webSocket).toBeFalsy();
    await response.body?.cancel();
  });

  it('answers 426 for an Upgrade header with the wrong value', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`${BASE_URL}/api/rooms/${boardId}`, {
      headers: { Upgrade: 'h2c' },
      duplex: 'half',
    } as RequestInit);
    expect(response.status).toBe(426);
    expect(response.webSocket).toBeFalsy();
    await response.body?.cancel();
  });

  it('accepts the header in any casing, as HTTP headers mean', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`${BASE_URL}/api/rooms/${boardId}`, {
      headers: { upgrade: 'WebSocket' },
      duplex: 'half',
    } as RequestInit);
    expect(response.status).toBe(101);
    response.webSocket?.accept();
    response.webSocket?.close();
  });
});

describe('everything else is static (TC-06)', () => {
  it('serves the built client at /', async () => {
    const response = await SELF.fetch(`${BASE_URL}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type') ?? '').toContain('text/html');
    const body = await response.text();
    expect(body).toContain('<div id="root">');
    // The built entry is referenced, not Vite's source entry.
    expect(body).toMatch(/<script type="module"[^>]*src="\/assets\/[^"]+\.js"/);
    expect(body).not.toContain('/src/client/main.tsx');
  });

  it('serves index.html for a board address (SPA fallback)', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`${BASE_URL}/b/${boardId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type') ?? '').toContain('text/html');
    const body = await response.text();
    expect(body).toContain('<div id="root">');
  });
});

describe('more people than the soft capacity (TC-13, live.over_capacity)', () => {
  it(`accepts the ${MAX_CONCURRENT_EDITORS + 1}th person and shares their note`, async () => {
    const boardId = newBoardId();
    const inside: SyncClient[] = [];
    for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
      inside.push(await connectedClient(`inside-${index}`, boardId));
    }

    const late = await connectClient('late', boardId);
    expect(late.closedWith).toBeNull();
    await waitFor(() => late.frames.length > 0, 5_000, 'the extra person to hear from the room');
    expect(late.isOpen).toBe(true);

    const id = late.createNote({ x: 0, y: 0 });
    expect(id).toBeTruthy();

    for (const client of inside) {
      await waitFor(() => client.board.some((note) => note.id === id), 5_000, `${client.name} to see the note`);
    }
    await waitFor(() => boardsAgree(...inside, late), 5_000, 'all screens to agree');
    closeAll(...inside, late);
  });
});

describe('boards stay separate (TC-17, live.isolation)', () => {
  it('shows nothing from one board on another', async () => {
    const first = newBoardId();
    const second = newBoardId();
    const onFirst = await connectedClient('on-first', first);
    const onSecond = await connectedClient('on-second', second);

    const id = onFirst.createNote({ x: 10, y: 20 });
    onFirst.type(id ?? '', 0, 'only on the first board');

    await waitFor(() => onFirst.board.length === 1, 5_000, 'the first board to have the note');
    // Give the second board every chance to be contaminated before deciding.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(onSecond.board).toEqual([]);

    const otherId = onSecond.createNote({ x: 0, y: 0 });
    await waitFor(() => onSecond.board.length === 1, 5_000, 'the second board to have its own note');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(onFirst.board.map((note) => note.id)).toEqual([id]);
    expect(onSecond.board.map((note) => note.id)).toEqual([otherId]);

    closeAll(onFirst, onSecond);
  });
});
