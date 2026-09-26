import { describe, it, expect } from 'vitest';

import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';

import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '../../src/shared/protocol';
import { applyRandomOp, makeRandom } from './helpers/random-ops';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import {
  RoomClient,
  SYNC_STEP_2,
  SYNC_UPDATE,
  boardsOf,
  connectClient,
  waitUntil,
} from './helpers/ws-client';

/**
 * sync.room_relay integration (TC-07..TC-12, TC-14..TC-16, TC-18, TC-31):
 * real Y.Docs, real WebSockets into the real BoardRoom, board changes made
 * only through the real `board-model` functions.
 */

function cloneDoc(source: Y.Doc): Y.Doc {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(source));
  return clone;
}

function json(board: ReturnType<RoomClient['board']>): string {
  return JSON.stringify(board);
}

describe('room relay', () => {
  it('TC-07: a note created by A appears in B', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    try {
      a.resetLog();
      b.resetLog();
      createSticky(a.doc, { x: 120, y: 240 });
      await waitUntil(() => b.board().length === 1, 'B never received the note');
      expect(json(b.board())).toEqual(json(a.board()));
      expect(b.updateMessages).toBe(1);
    } finally {
      a.close();
      b.close();
    }
  });

  it.each([
    ['move', 'TC-08'],
    ['recolour', 'TC-08'],
    ['text insert', 'TC-08'],
    ['delete', 'TC-08'],
  ])('%s: %s reaches B without echoing to A', async (kind) => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    try {
      const id = createSticky(a.doc, { x: 1, y: 2 });
      await waitUntil(() => b.board().length === 1, 'B never received the seed note');
      a.resetLog();
      b.resetLog();

      if (kind === 'move') {
        moveObject(a.doc, id, 333, 444);
        await waitUntil(() => b.board()[0]?.x === 333 && b.board()[0]?.y === 444);
      } else if (kind === 'recolour') {
        setStickyColor(a.doc, id, 'blue');
        await waitUntil(() => b.board()[0]?.color === 'blue');
      } else if (kind === 'text insert') {
        getStickyText(a.doc, id)?.insert(0, 'hello');
        await waitUntil(() => b.board()[0]?.text === 'hello');
      } else {
        deleteObject(a.doc, id);
        await waitUntil(() => b.board().length === 0);
      }

      expect(json(b.board())).toEqual(json(a.board()));
      expect(a.updateMessages).toBe(0);
    } finally {
      a.close();
      b.close();
    }
  });

  it('TC-09: concurrent text inserts merge to "red green blue"', async () => {
    const boardId = newBoardId();
    const base = new Y.Doc();
    const id = createSticky(base, { x: 0, y: 0 });
    getStickyText(base, id)?.insert(0, 'green');

    const aDoc = cloneDoc(base);
    const bDoc = cloneDoc(base);
    getStickyText(aDoc, id)?.insert(0, 'red ');
    getStickyText(bDoc, id)?.insert(5, ' blue');

    const a = new RoomClient(aDoc);
    const b = new RoomClient(bDoc);
    try {
      await a.connect(boardId);
      await a.sync();
      await b.connect(boardId);
      await b.sync();
      await waitUntil(
        () =>
          a.board()[0]?.text === 'red green blue' && b.board()[0]?.text === 'red green blue',
        `did not converge: ${JSON.stringify(boardsOf([a, b]))}`,
      );
    } finally {
      a.close();
      b.close();
    }
  });

  it('TC-10: concurrent numeric writes converge to one value on both', async () => {
    const boardId = newBoardId();
    const base = new Y.Doc();
    const id = createSticky(base, { x: 0, y: 0 });

    const aDoc = cloneDoc(base);
    const bDoc = cloneDoc(base);
    moveObject(aDoc, id, 100, 0);
    moveObject(bDoc, id, 300, 0);

    const a = new RoomClient(aDoc);
    const b = new RoomClient(bDoc);
    try {
      await a.connect(boardId);
      await a.sync();
      await b.connect(boardId);
      await b.sync();
      await waitUntil(
        () => a.board()[0]?.x === b.board()[0]?.x,
        `did not converge: ${JSON.stringify(boardsOf([a, b]))}`,
      );
      expect([100, 300]).toContain(a.board()[0]?.x);
      expect(json(a.board())).toEqual(json(b.board()));
    } finally {
      a.close();
      b.close();
    }
  });

  it('TC-11: concurrent delete and text insert leave the note gone on both, text nowhere', async () => {
    const boardId = newBoardId();
    const base = new Y.Doc();
    const id = createSticky(base, { x: 0, y: 0 });
    getStickyText(base, id)?.insert(0, 'keep');

    const aDoc = cloneDoc(base);
    const bDoc = cloneDoc(base);
    deleteObject(aDoc, id);
    getStickyText(bDoc, id)?.insert(0, 'xyz');

    const a = new RoomClient(aDoc);
    const b = new RoomClient(bDoc);
    try {
      await a.connect(boardId);
      await a.sync();
      await b.connect(boardId);
      await b.sync();
      await waitUntil(() => a.board().length === 0 && b.board().length === 0);
      expect(json(a.board())).toEqual(json(b.board()));
      expect(json(a.board())).not.toContain('xyz');
      expect(json(b.board())).not.toContain('xyz');
    } finally {
      a.close();
      b.close();
    }
  });

  it(`TC-12: ${MAX_CONCURRENT_EDITORS} clients x 200 seeded ops converge to identical snapshots`, async () => {
    const seed = 20260726;
    const boardId = newBoardId();
    const clients = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS }, () => connectClient(boardId)),
    );
    try {
      // Interleave operations across clients so updates flow while editing.
      const random = makeRandom(seed);
      for (let round = 0; round < 200; round += 1) {
        for (const client of clients) {
          applyRandomOp(client.doc, random);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await waitUntil(
        () => new Set(boardsOf(clients)).size === 1,
        `snapshots differ: ${JSON.stringify(boardsOf(clients))}`,
        15_000,
      );
      expect(clients[0].board().length).toBeGreaterThan(0);
    } finally {
      for (const client of clients) client.close();
    }
  }, 60_000);

  it('TC-14: a late joiner receives the full document on first sync', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    for (let i = 0; i < 10; i += 1) {
      createSticky(a.doc, { x: i * 10, y: 0 });
      createSticky(b.doc, { x: 0, y: i * 10 });
    }
    await waitUntil(() => a.board().length === 20 && b.board().length === 20);
    const c = await connectClient(boardId);
    try {
      expect(json(c.board())).toEqual(json(a.board()));
    } finally {
      a.close();
      b.close();
      c.close();
    }
  });

  describe('TC-15: malformed traffic', () => {
    const cases: Array<[string, (client: RoomClient) => void]> = [
      ['text frame', (client) => client.sendRaw('hello')],
      [
        'frame truncated mid payload',
        // SyncStep2 declaring a 10-byte payload but ending after 2 bytes.
        (client) => client.sendRaw(syncFrame([SYNC_STEP_2, 10, 1, 2])),
      ],
      ['unknown message type 9', (client) => client.sendRaw(new Uint8Array([9, 1]))],
      [
        'invalid Yjs update',
        (client) => {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, SYNC_UPDATE);
          encoding.writeVarUint8Array(encoder, new Uint8Array([0xff, 0xff, 0xff, 0xff]));
          client.sendRaw(syncFrame(encoding.toUint8Array(encoder)));
        },
      ],
    ];

    it.each(cases)('%s closes the socket with 1003 and leaves the room usable', async (_name, poison) => {
      const boardId = newBoardId();
      const a = await connectClient(boardId);
      const b = await connectClient(boardId);
      try {
        poison(a);
        await a.whenClosed();
        expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);

        expect(b.closed).toBe(false);
        expect(b.board()).toHaveLength(0);

        // The room still relays for everyone else.
        const c = await connectClient(boardId);
        try {
          const id = createSticky(c.doc, { x: 7, y: 7 });
          await waitUntil(() => b.board().some((note) => note.id === id), 'B stopped receiving');
        } finally {
          c.close();
        }
      } finally {
        a.close();
        b.close();
      }
    });
  });

  it('TC-16: awareness bytes are relayed verbatim to sender and others', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    try {
      a.resetLog();
      b.resetLog();
      const payload = new Uint8Array([9, 1, 2, 3, 4, 255]);
      const sent = a.sendAwareness(payload);
      await waitUntil(
        () =>
          a.log.some((entry) => entry.kind === 'awareness') &&
          b.log.some((entry) => entry.kind === 'awareness'),
        'awareness was not relayed to both sockets',
      );
      const fromA = a.log.find((entry) => entry.kind === 'awareness')?.bytes;
      const fromB = b.log.find((entry) => entry.kind === 'awareness')?.bytes;
      expect(Array.from(fromA ?? [])).toEqual(Array.from(sent));
      expect(Array.from(fromB ?? [])).toEqual(Array.from(sent));
    } finally {
      a.close();
      b.close();
    }
  });

  it('TC-18: a closed room loses nothing because clients recreate it on reconnect', async () => {
    const first = newBoardId();
    const a = await connectClient(first);
    for (let i = 0; i < 3; i += 1) {
      createSticky(a.doc, { x: i, y: i });
    }
    await waitUntil(() => a.board().length === 3);
    const b = await connectClient(first);
    await waitUntil(() => json(b.board()) === json(a.board()));
    const expected = json(a.board());

    a.close();
    b.close();
    await Promise.all([a.whenClosed(), b.whenClosed()]);

    // Fresh object id: the clients' documents recreate the room contents.
    const fresh = newBoardId();
    await a.connect(fresh);
    await a.sync();
    expect(json(a.board())).toEqual(expected);

    await b.connect(fresh);
    await b.sync();
    await waitUntil(() => json(b.board()) === json(a.board()));
    expect(json(a.board())).toEqual(expected);
    a.close();
    b.close();
  });

  it('TC-31: a closed socket does not throw in the room; later sockets still receive', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    try {
      b.close();
      // Race the close event: the room may still hold B's socket when the
      // broadcast happens. Any send failure must be contained (TC-31).
      createSticky(a.doc, { x: 1, y: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(b.closed).toBe(true);

      const c = await connectClient(boardId);
      try {
        const id = createSticky(c.doc, { x: 2, y: 2 });
        await waitUntil(() => a.board().some((note) => note.id === id), 'A stopped receiving');
      } finally {
        c.close();
      }
    } finally {
      a.close();
      b.close();
    }
  });
});

/** y-websocket sync frame: `varuint(0)` then the y-protocols message inline. */
function syncFrame(inner: ArrayLike<number>): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeUint8Array(encoder, Uint8Array.from(inner));
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}
