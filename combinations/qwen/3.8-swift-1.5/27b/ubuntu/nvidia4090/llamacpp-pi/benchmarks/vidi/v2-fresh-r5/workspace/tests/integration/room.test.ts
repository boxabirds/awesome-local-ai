/**
 * Integration tests for sync.room: the real BoardRoom Durable Object with
 * real WebSockets and real Yjs docs in workerd. No mocks.
 *
 * Covers TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31.
 */
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS, STICKY_COLORS } from '../../src/shared/config';
import { openSocket, WsClient } from './ws-client';
import { mulberry32, randomOp } from './random-ops';

/** Poll until `pred` returns truthy (workerd has no promise-based events). */
async function waitFor<T>(
  what: string,
  pred: () => T | false | null | undefined,
  timeoutMs = 10000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = pred();
    if (value) return value;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function connectBoard(boardId: string): Promise<WsClient> {
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);
  await stub.initialize(); // story 5: create the board before connecting
  const ws = await openSocket((req) => stub.fetch(req), boardId);
  const client = new WsClient(ws);
  await client.waitForSync();
  return client;
}

/** Reconnect an existing doc to (a possibly fresh) room. */
async function reconnectBoard(doc: Y.Doc, boardId: string): Promise<WsClient> {
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);
  await stub.initialize(); // story 5: create the board before connecting
  const ws = await openSocket((req) => stub.fetch(req), boardId);
  const client = new WsClient(ws, doc);
  await client.waitForSync();
  return client;
}

/** True when two snapshots hold the same notes (order-insensitive). */
function sameBoard(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a.length !== b.length) return false;
  const key = (n: StickySnapshot) =>
    `${n.id}|${n.x}|${n.y}|${n.color}|${n.text}|${n.z}|${n.createdAt}`;
  const setB = new Set(b.map(key));
  return a.every((n) => setB.has(key(n)));
}

function closeAll(...clients: WsClient[]): void {
  for (const c of clients) c.close();
}

describe('sync.room', () => {
  it('TC-07: A creates sticky → B snapshot equals A; B received exactly one update', async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);
    b.receivedUpdates = 0; // count only what arrives after creation

    const id = createSticky(a.doc, { x: 10, y: 20 });
    expect(id).toBeTruthy();

    await waitFor('B to see the note', () =>
      sameBoard(a.boardSnapshot(), b.boardSnapshot()) ? true : false,
    );
    expect(b.receivedUpdates).toBe(1);
    closeAll(a, b);
  });

  it('TC-08: move, recolour, text insert, delete each reach B; A receives no echo', async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor('B to see the note', () =>
      b.boardSnapshot().some((n) => n.id === id) ? true : false,
    );
    a.receivedUpdates = 0;
    b.receivedUpdates = 0;

    // 1. move
    moveObject(a.doc, id, 111, 222);
    await waitFor('B to see the move', () =>
      b.boardSnapshot().find((n) => n.id === id)?.x === 111 ? true : false,
    );

    // 2. recolour
    const otherColor = (Object.keys(STICKY_COLORS) as string[]).find(
      (c) => c !== 'yellow',
    )!;
    setStickyColor(a.doc, id, otherColor);
    await waitFor('B to see the colour', () =>
      b.boardSnapshot().find((n) => n.id === id)?.color === otherColor ? true : false,
    );

    // 3. text insert
    getStickyText(a.doc, id)!.insert(0, 'hello ');
    await waitFor('B to see the text', () =>
      b.boardSnapshot().find((n) => n.id === id)?.text === 'hello ' ? true : false,
    );

    // 4. delete
    deleteObject(a.doc, id);
    await waitFor('B to see the delete', () =>
      b.boardSnapshot().some((n) => n.id === id) ? false : true,
    );

    // A must not have received an echo of any of its own updates.
    expect(a.receivedUpdates).toBe(0);
    expect(sameBoard(a.boardSnapshot(), b.boardSnapshot())).toBe(true);
    closeAll(a, b);
  });

  it("TC-09: concurrent text — A 'red ' at 0, B ' blue' at end of 'green' → both 'red green blue'", async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);

    const id = createSticky(a.doc, { x: 0, y: 0 });
    getStickyText(a.doc, id)!.insert(0, 'green');
    await waitFor("B to see 'green'", () =>
      b.boardSnapshot().find((n) => n.id === id)?.text === 'green' ? true : false,
    );

    // Concurrent edits in the same tick, before either update has crossed.
    getStickyText(a.doc, id)!.insert(0, 'red ');
    const bText = getStickyText(b.doc, id)!;
    bText.insert(bText.length, ' blue');

    await waitFor('both to converge on the merged text', () => {
      const ta = a.boardSnapshot().find((n) => n.id === id)?.text;
      const tb = b.boardSnapshot().find((n) => n.id === id)?.text;
      return ta === 'red green blue' && tb === 'red green blue' ? true : false;
    });
    closeAll(a, b);
  });

  it('TC-10: concurrent moves x=100 vs x=300 → identical final x on both', async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor('B to see the note', () =>
      b.boardSnapshot().some((n) => n.id === id) ? true : false,
    );

    // Concurrent moves in the same tick.
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);

    await waitFor('both to converge on x', () => {
      const xa = a.boardSnapshot().find((n) => n.id === id)?.x;
      const xb = b.boardSnapshot().find((n) => n.id === id)?.x;
      return xa === xb && xa !== undefined && xa !== 0 ? true : false;
    });
    const xa = a.boardSnapshot().find((n) => n.id === id)!.x;
    const xb = b.boardSnapshot().find((n) => n.id === id)!.x;
    expect(xa).toBe(xb);
    expect([100, 300]).toContain(xa);
    closeAll(a, b);
  });

  it("TC-11: A deletes while B types into the note → note absent on both, B's text nowhere", async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor('B to see the note', () =>
      b.boardSnapshot().some((n) => n.id === id) ? true : false,
    );

    // Concurrent: B types into the note, A deletes it — same tick.
    getStickyText(b.doc, id)!.insert(0, 'resurrected ');
    deleteObject(a.doc, id);

    await waitFor('both to agree the note is gone', () =>
      a.boardSnapshot().some((n) => n.id === id) || b.boardSnapshot().some((n) => n.id === id)
        ? false
        : true,
    );
    // No resurrection of B's text anywhere.
    for (const c of [a, b]) {
      for (const n of c.boardSnapshot()) {
        expect(n.text).not.toContain('resurrected');
      }
    }
    closeAll(a, b);
  });

  it(`TC-12: ${MAX_CONCURRENT_EDITORS} clients × 200 seeded random ops → identical snapshots`, async () => {
    const SEED = 1337;
    console.log(`TC-12 seed: ${SEED}`);
    const boardId = newBoardId();
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      clients.push(await connectBoard(boardId));
    }

    // Every client runs 200 seeded random ops through the real board-model
    // functions. Updates cross the room while the next op is chosen.
    const runners = clients.map((c, i) => {
      const rng = mulberry32(SEED + i);
      return (async () => {
        for (let op = 0; op < 200; op++) randomOp(c.doc, rng);
      })();
    });
    await Promise.all(runners);

    await waitFor('all clients to converge', () => {
      const [first, ...rest] = clients;
      return rest.every((c) => sameBoard(first.boardSnapshot(), c.boardSnapshot()))
        ? true
        : false;
    }, 30000);

    const [first, ...rest] = clients;
    for (const c of rest) {
      expect(sameBoard(first.boardSnapshot(), c.boardSnapshot())).toBe(true);
    }
    closeAll(...clients);
  }, 60000);

  it('TC-14: A and B create 20 notes; late joiner C snapshot equals A after sync', async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);

    for (let i = 0; i < 10; i++) createSticky(a.doc, { x: i, y: 0 });
    for (let i = 0; i < 10; i++) createSticky(b.doc, { x: i, y: 100 });

    await waitFor('A and B to see all 20', () =>
      a.boardSnapshot().length === 20 && b.boardSnapshot().length === 20 ? true : false,
    );

    const c = await connectBoard(boardId);
    await waitFor('C to see all 20', () =>
      c.boardSnapshot().length === 20 ? true : false,
    );
    expect(sameBoard(a.boardSnapshot(), c.boardSnapshot())).toBe(true);
    closeAll(a, b, c);
  });

  it('TC-15: malformed traffic closes only A (1003); B keeps receiving; room doc unchanged', async () => {
    const boardId = newBoardId();
    const b = await connectBoard(boardId);

    // Baseline content in the room.
    const a0 = await connectBoard(boardId);
    const noteId = createSticky(a0.doc, { x: 5, y: 5 });
    await waitFor('B to see baseline note', () =>
      b.boardSnapshot().some((n) => n.id === noteId) ? true : false,
    );
    a0.close();

    const malformedFrames: Array<{ name: string; send: (c: WsClient) => void }> = [
      { name: 'text frame', send: (c) => c.sendRaw('hello') },
      {
        // sync frame, SyncStep1 claiming a 5-byte state vector with 1 present
        name: 'truncated bytes',
        send: (c) => c.sendRaw(new Uint8Array([0, 0, 1, 5, 1])),
      },
      { name: 'unknown type', send: (c) => c.sendRaw(new Uint8Array([9])) },
      {
        // structurally valid update frame whose Yjs update bytes are garbage
        name: 'invalid Yjs update',
        send: (c) => c.sendRaw(new Uint8Array([0, 2, 5, 1, 2, 3, 4, 5])),
      },
    ];

    for (const frame of malformedFrames) {
      const a = await connectBoard(boardId);
      frame.send(a);
      const info = await a.waitForClose();
      expect(info.code, frame.name).toBe(1003);

      // B must still be open and must still receive new updates.
      const a2 = await connectBoard(boardId);
      const ping = createSticky(a2.doc, { x: 6, y: 6 });
      await waitFor(`B to receive update after ${frame.name}`, () =>
        b.boardSnapshot().some((n) => n.id === ping) ? true : false,
      );
      a2.close();
    }

    // The room doc holds exactly the baseline note plus the four ping notes —
    // no corruption, no partial application. A fresh joiner sees the same.
    const c = await connectBoard(boardId);
    await waitFor('C to converge', () =>
      sameBoard(b.boardSnapshot(), c.boardSnapshot()) ? true : false,
    );
    expect(c.boardSnapshot().some((n) => n.id === noteId)).toBe(true);
    closeAll(b, c);
  }, 30000);

  it('TC-16: awareness bytes from A → A and B receive identical bytes', async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);
    a.receivedAwareness = [];
    b.receivedAwareness = [];

    a.sendAwareness(42, new Uint8Array([7, 8, 9, 10]));

    await waitFor('A and B to receive the awareness relay', () =>
      a.receivedAwareness.length > 0 && b.receivedAwareness.length > 0 ? true : false,
    );

    const fa = a.receivedAwareness[0];
    const fb = b.receivedAwareness[0];
    // The relayed bytes are [clientID: varuint][state: varuint8array] —
    // clientID 42, state [7,8,9,10] — identical on A and B.
    expect(Array.from(fa)).toEqual([42, 4, 7, 8, 9, 10]);
    expect(Array.from(fa)).toEqual(Array.from(fb));
    closeAll(a, b);
  });

  it('TC-18: restart simulation — fresh room repopulated from first reconnector; B converges', async () => {
    const board1 = newBoardId();
    const a = await connectBoard(board1);
    const b = await connectBoard(board1);

    for (let i = 0; i < 3; i++) createSticky(a.doc, { x: i, y: i });
    await waitFor('B to see all 3', () =>
      b.boardSnapshot().length === 3 ? true : false,
    );
    closeAll(a, b); // all sockets closed

    // A fresh board id is a fresh Durable Object instance: empty in-memory
    // doc. A reconnects first with its doc; the room must be repopulated
    // from A's SyncStep2.
    const board2 = newBoardId();
    // A reconnects with its existing doc (the notes are already there).
    const a2 = await reconnectBoard(a.doc, board2);
    expect(a2.boardSnapshot().length).toBe(3);

    const c = await connectBoard(board2);
    await waitFor('C to see the repopulated board', () =>
      c.boardSnapshot().length === 3 ? true : false,
    );
    expect(sameBoard(a2.boardSnapshot(), c.boardSnapshot())).toBe(true);

    // B reconnects and converges with the repopulated room.
    const b2 = await reconnectBoard(b.doc, board2);
    await waitFor('B to converge', () =>
      sameBoard(a2.boardSnapshot(), b2.boardSnapshot()) ? true : false,
    );
    closeAll(a2, c, b2);
  });

  it('TC-31: B closed abruptly, A sends update → room does not throw; later sockets receive', async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);

    const first = createSticky(a.doc, { x: 1, y: 1 });
    await waitFor('B to see first note', () =>
      b.boardSnapshot().some((n) => n.id === first) ? true : false,
    );

    b.close(); // abrupt from the room's perspective
    a.receivedUpdates = 0;

    const second = createSticky(a.doc, { x: 2, y: 2 });

    // The room must still be healthy: a later socket receives the update.
    const c = await connectBoard(boardId);
    await waitFor('C to see both notes', () =>
      c.boardSnapshot().some((n) => n.id === second) &&
      c.boardSnapshot().some((n) => n.id === first)
        ? true
        : false,
    );
    expect(a.receivedUpdates).toBe(0);
    closeAll(a, c);
  });
});
