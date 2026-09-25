/**
 * Integration tests for the Worker entry (design task 5: TC-04 to TC-06,
 * TC-13, TC-17).
 *
 * Everything goes through `SELF.fetch`, which reaches the real
 * `src/worker/index.ts`: the same handler that runs in workerd in production,
 * with the real `BOARD_ROOM` namespace and the real static-asset binding.
 *
 * @see spec/stories/03-live-collaboration/design.md
 */
import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { TestPeer, settle, waitFor } from './helpers/ws-client';

/** Upgrade headers, as a browser's provider would send them. */
function upgradeHeaders(): Record<string, string> {
  return {
    Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': 'dE4q5P8zRb0oZ0uS0m0T0g==',
  };
}

/** Ask the real Worker about a room address, without opening a socket. */
function requestRoom(path: string, upgrade: boolean): Promise<Response> {
  return SELF.fetch(`https://board.example${path}`, {
    headers: upgrade ? upgradeHeaders() : { 'X-not-an-upgrade': '1' },
  });
}

/**
 * Watch the `BOARD_ROOM` namespace for the duration of `run`.
 *
 * Used by TC-04: an address that cannot name a board must not create an
 * object, so the test has to see whether `idFromName` was reached at all.
 */
async function withNamespaceSpy<T>(
  run: (calls: string[]) => Promise<T>,
): Promise<T> {
  const real = env.BOARD_ROOM;
  const calls: string[] = [];
  const spy = {
    idFromName(name: string) {
      calls.push(name);
      return real.idFromName(name);
    },
    get(id: DurableObjectId) {
      return real.get(id);
    },
  } as unknown as typeof env.BOARD_ROOM;
  env.BOARD_ROOM = spy;
  try {
    return await run(calls);
  } finally {
    env.BOARD_ROOM = real;
  }
}

describe('the Worker refuses an address that cannot name a board (TC-04)', () => {
  const invalid = [
    'bad!id',
    '',
    'a'.repeat(21),
    'a'.repeat(23),
    'AAAAAAAAAAAAAAAAAAAAA+',
    'aaaaaaaa-aaaaaaaaaaaaaaaa',
    'aaaaaaaa%20aaaaaaaaaaaaaaaa',
  ];

  for (const id of invalid) {
    it(`answers 400 for "${id}" and never looks up a room`, async () => {
      const outcome = await withNamespaceSpy(async (calls) => {
        const response = await requestRoom(`/api/rooms/${id}`, true);
        return { status: response.status, calls: [...calls] };
      });
      expect(outcome.status).toBe(400);
      // The negative half of the case: no namespace lookup, so no object
      // instance and no namespace in storage either.
      expect(outcome.calls).toEqual([]);
    });
  }

  // `..` is resolved while the address is parsed, so a traversal never *names*
  // a room: either the app answers it or it is refused as a bad room address.
  // Both are fine; what must never happen is a lookup, because that is what
  // would let one address reach somebody else's board.
  it('never lets a path traversal reach a room', async () => {
    const board = newBoardId();
    const paths = ['/api/rooms/../x', `/api/rooms/../${board}`, '/api/rooms/%2E%2E/x'];

    for (const path of paths) {
      const outcome = await withNamespaceSpy(async (calls) => {
        const response = await requestRoom(path, true);
        return {
          status: response.status,
          type: response.headers.get('content-type') ?? '',
          calls: [...calls],
        };
      });
      expect([200, 400], `${path} was answered without naming a board`).toContain(
        outcome.status,
      );
      if (outcome.status === 200) {
        expect(outcome.type, `${path} is the app, not a room`).toContain('text/html');
      }
      expect(outcome.calls, `${path} looked no room up`).toEqual([]);
    }
  });

  it('refuses a valid id with junk after it', async () => {
    const board = newBoardId();
    for (const path of [`/api/rooms/${board}/extra`, `/api/rooms/${board}/`, `/api/rooms/${board}%2Fextra`]) {
      const response = await requestRoom(path, true);
      expect(response.status, path).toBe(400);
    }
  });
});

describe('the Worker separates rooms from the app (TC-05, TC-06)', () => {
  it('answers 426 for a valid board id without an Upgrade header', async () => {
    const board = newBoardId();
    const response = await requestRoom(`/api/rooms/${board}`, false);
    // 426, not 400: the address is fine, only the request shape is not.
    expect(response.status).toBe(426);
  });

  it('serves the app for /b/<board id>', async () => {
    const board = newBoardId();
    const response = await SELF.fetch(`https://board.example/b/${board}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('<div id="root">');
  });

  it('serves the app for the bare origin path as well', async () => {
    const response = await SELF.fetch('https://board.example/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
  });
});

describe('the room holds more than the configured capacity (TC-13)', () => {
  it('accepts capacity + 1 editors and still relays between all of them', async () => {
    const board = newBoardId();
    const count = MAX_CONCURRENT_EDITORS + 1;
    const peers: TestPeer[] = [];
    for (let index = 0; index < count; index += 1) {
      peers.push(await TestPeer.connect(board, { name: `peer-${index}` }));
    }
    await settle(peers);

    // The soft capacity: nobody is refused.
    expect(peers).toHaveLength(count);
    for (const peer of peers) {
      expect(peer.socket.readyState, `${peer.name} is open`).toBe(WebSocket.OPEN);
    }

    // ...and the extra joiner is a member of the board, not a bystander: a
    // note made by the last one to arrive reaches every other one.
    const last = peers[peers.length - 1]!;
    const id = createSticky(last.doc, { x: 0, y: 0 }, 'blue');
    expect(id).not.toBe('');
    await waitFor(
      () => peers.slice(0, -1).every((peer) => snapshot(peer.doc).length === 1),
      'every other editor to see the note',
    );
    await settle(peers);
    const summary = JSON.stringify(snapshot(last.doc));
    for (const peer of peers.slice(0, -1)) {
      expect(JSON.stringify(snapshot(peer.doc)), peer.name).toBe(summary);
    }
  });
});

describe('two boards are two rooms (TC-17)', () => {
  it('keeps a note made in one board out of another', async () => {
    const first = newBoardId();
    const second = newBoardId();
    const inFirst = await TestPeer.connect(first, { name: 'A' });
    const inSecond = await TestPeer.connect(second, { name: 'B' });
    await settle([inFirst, inSecond]);

    const framesBefore = inSecond.frames.length;
    createSticky(inFirst.doc, { x: 10, y: 10 });
    await waitFor(() => snapshot(inFirst.doc).length === 1, 'A to hold its note');
    await settle([inFirst, inSecond]);

    // The negative half: B received nothing at all, not even a sync reply.
    expect(inSecond.frames).toHaveLength(framesBefore);
    expect(inSecond.updateCount()).toBe(0);
    expect(snapshot(inSecond.doc)).toEqual([]);
    expect(inSecond.doc.getMap<unknown>('objects').size).toBe(0);
  });
});
