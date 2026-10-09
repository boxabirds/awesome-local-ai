import { env, evictDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSticky, deleteObject, getStickyText, initDoc, moveObject, setStickyColor } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS } from '../../src/shared/protocol';
import { applyRandomOps, randomOps } from '../fixtures/random-ops';
import type { TestClient } from './helpers/ws-client';
import {
  awarenessFrame,
  awarenessUpdate,
  connectClients,
  disconnectClients,
  settle,
  TestClient as newClient,
  updateFrame,
  waitForConvergence,
} from './helpers/ws-client';

/**
 * The room itself (`sync.room`) under real WebSockets and real Yjs: what two replicas
 * end up holding is the whole point, and nothing below is mocked.
 */

interface Seat {
  boardId: string;
  a: TestClient;
  b: TestClient;
  /** The one note both start with. */
  id: string;
}

/** Two participants who agree on one note, optionally carrying some text. */
async function twoClientsWithNote(text = ''): Promise<Seat> {
  const boardId = newBoardId();
  const [a, b] = await connectClients(boardId, 2);
  initDoc(a.doc);
  const id = createSticky(a.doc, { x: 300, y: 200 });
  if (typeof id !== 'string') throw new Error('createSticky failed');
  if (text !== '') getStickyText(a.doc, id)?.insert(0, text);
  await waitForConvergence([a, b]);
  return { boardId, a, b, id };
}

/** Both go away and keep editing, the way people do when their connection drops. */
async function offline(pair: Seat): Promise<void> {
  await pair.a.close();
  await pair.b.close();
  expect([pair.a.isOpen, pair.b.isOpen]).toEqual([false, false]);
}

/** ...and come back, which is when their documents have to agree. */
async function backOnline(pair: Seat): Promise<void> {
  await pair.a.open();
  await pair.b.open();
  await waitForConvergence([pair.a, pair.b]);
}

describe('board room', () => {
  it('TC-07 delivers a new note to the other replica exactly once', async () => {
    const { a, b } = await twoClientsWithNote();
    try {
      a.mark();
      b.mark();
      const id = createSticky(a.doc, { x: 900, y: 40 }, 'blue');
      if (typeof id !== 'string') throw new Error('createSticky failed');
      await b.waitUntil('the new note', () => b.notes().length === 2);
      expect(b.notes()).toEqual(a.notes());
      // Exactly one update frame: no duplicates, no batching, no echo back.
      expect(b.updates()).toBe(1);
      expect(a.updates()).toBe(0);
      await waitForConvergence([a, b]);
    } finally {
      await disconnectClients([a, b]);
    }
  });

  // TC-08: one case per kind of change, each checking the sender gets no echo either.
  const changes: Array<[string, (doc: Y.Doc, id: string) => void, (notes: readonly object[]) => void]> = [
    [
      'moves a note',
      (doc, id) => void moveObject(doc, id, 42, -18),
      (notes) => expect((notes[0] as { x: number }).x).toBe(42),
    ],
    [
      'recolours a note',
      (doc, id) => void setStickyColor(doc, id, 'violet'),
      (notes) => expect((notes[0] as { color: string }).color).toBe('violet'),
    ],
    [
      'types into a note',
      (doc, id) => void getStickyText(doc, id)?.insert(0, 'Handoffs between design and QA '),
      (notes) =>
        expect((notes[0] as { text: string }).text).toBe('Handoffs between design and QA '),
    ],
    [
      'deletes a note',
      (doc, id) => void deleteObject(doc, id),
      (notes) => expect(notes).toHaveLength(0),
    ],
  ];
  describe.each(changes)('TC-08 %s', (_what, change, check) => {
    it('reaches the other replica and never comes back to the sender', async () => {
      const { a, b, id } = await twoClientsWithNote();
      try {
        a.mark();
        b.mark();
        change(a.doc, id);
        await waitForConvergence([a, b]);
        check([...a.notes()]);
        check([...b.notes()]);
        expect(b.notes()).toEqual(a.notes());
        expect(a.updates()).toBe(0);
      } finally {
        await disconnectClients([a, b]);
      }
    });
  });

  it('TC-09 keeps both concurrent text inserts on both replicas', async () => {
    const pair = await twoClientsWithNote('green');
    const { a, b, id } = pair;
    try {
      await offline(pair);
      const textA = getStickyText(a.doc, id);
      const textB = getStickyText(b.doc, id);
      // Neither has seen the other's keystroke: two different notes now.
      textA?.insert(0, 'red ');
      textB?.insert(textB?.toString().length ?? 0, ' blue');
      expect([a.notes()[0]?.text, b.notes()[0]?.text]).toEqual(['red green', 'green blue']);

      await backOnline(pair);
      expect(a.notes()[0]?.text).toBe('red green blue');
      expect(b.notes()[0]?.text).toBe('red green blue');
    } finally {
      await disconnectClients([a, b]);
    }
  });

  it('TC-10 resolves concurrent moves to one position on both replicas', async () => {
    const pair = await twoClientsWithNote();
    const { a, b, id } = pair;
    try {
      await offline(pair);
      moveObject(a.doc, id, 100, 5);
      moveObject(b.doc, id, 300, 5);
      await backOnline(pair);
      const settled = a.notes()[0]?.x;
      expect(settled).toBe(b.notes()[0]?.x);
      // One of the two positions wins outright; nobody ends up halfway between.
      expect([100, 300]).toContain(settled);
    } finally {
      await disconnectClients([a, b]);
    }
  });

  it('TC-11 lets a delete win over a concurrent edit inside it', async () => {
    const pair = await twoClientsWithNote('draft');
    const { boardId, a, b, id } = pair;
    try {
      await offline(pair);
      deleteObject(a.doc, id);
      getStickyText(b.doc, id)?.insert(5, ' (still typing)');
      await backOnline(pair);
      // The note stays deleted and its text is nowhere on either replica.
      expect(a.notes()).toHaveLength(0);
      expect(b.notes()).toHaveLength(0);
      expect(a.stateVector()).toBe(b.stateVector());
      // And the room took it as well as the clients did: somebody joining now sees an
      // empty board, with no exception on the way.
      const joiner = await newClient.connect(boardId);
      try {
        await settle();
        expect(joiner.notes()).toHaveLength(0);
        expect([a.isOpen, b.isOpen, joiner.isOpen]).toEqual([true, true, true]);
      } finally {
        await disconnectClients([joiner]);
      }
    } finally {
      await disconnectClients([a, b]);
    }
  });

  it('TC-12 converges MAX_CONCURRENT_EDITORS clients over 200 seeded random ops', async () => {
    const seed = 1970;
    const boardId = newBoardId();
    const clients = await connectClients(boardId, MAX_CONCURRENT_EDITORS);
    try {
      initDoc(clients[0]!.doc);
      const ops = randomOps(200, seed);
      const ids: string[] = [];
      const owner = new Map<string, TestClient>();
      const log: string[] = [];
      ops.forEach((op, step) => {
        if (op.kind === 'create' || ids.length === 0) {
          const client = clients[step % clients.length]!;
          log.push(...applyRandomOps(client.doc, [op], ids));
          const created = ids[ids.length - 1];
          if (created !== undefined) owner.set(created, client);
          return;
        }
        // Notes are edited by whoever made them, so the op is never applied to a
        // replica that has not heard of the note yet.
        const index = op.index % ids.length;
        const target = ids[index]!;
        const client = owner.get(target) ?? clients[0]!;
        log.push(...applyRandomOps(client.doc, [{ ...op, index }], ids));
      });

      await waitForConvergence(clients);
      const [first, ...rest] = clients;
      for (const client of rest) expect(client.notes()).toEqual(first!.notes());

      // Editing after the soak still converges, so the run did not wedge anything.
      createSticky(clients[2]!.doc, { x: 5, y: 5 });
      await waitForConvergence(clients);
      expect(clientHasNotes(clients)).toBe(true);
      console.log(
        `TC-12 seed=${seed} ops=${ops.length} notes=${first!.notes().length} ` +
          `clients=${clients.length} state=${first!.stateVector().slice(0, 24)}…`,
      );
    } finally {
      await disconnectClients(clients);
    }
  });

  it('TC-14 gives a late joiner the whole board', async () => {
    const { boardId, a, b } = await twoClientsWithNote();
    try {
      for (let index = 0; index < 19; index += 1) {
        createSticky(index % 2 === 0 ? a.doc : b.doc, { x: index * 50, y: index * 20 });
      }
      await waitForConvergence([a, b]);
      expect(a.notes()).toHaveLength(20);
      const joiner = await newClient.connect(boardId);
      try {
        await joiner.waitUntil('all twenty notes', () => joiner.notes().length === 20);
        expect(joiner.notes()).toEqual(a.notes());
      } finally {
        await disconnectClients([joiner]);
      }
    } finally {
      await disconnectClients([a, b]);
    }
  });

  // TC-15: four kinds of traffic no board client produces, run one at a time.
  const badTraffic: Array<[string, (client: TestClient) => void]> = [
    ['a text frame', (client) => client.sendRaw('{"type":0}')],
    [
      'a truncated awareness frame',
      (client) => client.sendRaw(new Uint8Array([MESSAGE_AWARENESS, 40, 1, 2, 3])),
    ],
    ['an unknown message type', (client) => client.sendRaw(new Uint8Array([9, 1, 2, 3]))],
    [
      'an invalid Yjs update',
      (client) =>
        client.sendRaw(updateFrame(new Uint8Array([0xff, 0xff, 0xff, 0x7f, 0, 0, 0]))),
    ],
  ];
  describe.each(badTraffic)('TC-15 %s', (_what, poison) => {
    it('closes only the sender and leaves the room untouched', async () => {
      const { boardId, a, b } = await twoClientsWithNote('untouched');
      try {
        b.mark();
        const before = JSON.stringify(b.notes());
        const closes = a.closes.length;
        poison(a);
        await a.waitUntil('the room to close the sender', () => a.closes.length > closes);
        expect(a.lastClose?.code).toBe(CLOSE_UNSUPPORTED_DATA);
        expect(a.isOpen).toBe(false);
        await settle();
        // The other participant noticed nothing and the document did not change.
        expect(b.isOpen).toBe(true);
        expect(JSON.stringify(b.notes())).toBe(before);
        expect(b.countFrames(MESSAGE_AWARENESS)).toBe(0);
        // The room still holds the board for anybody who asks, and still relays.
        const joiner = await newClient.connect(boardId);
        try {
          await joiner.waitUntil('the board as it was', () => joiner.notes().length === 1);
          expect(joiner.notes()[0]?.text).toBe('untouched');
          // Still relaying for everybody else: one update for the next note.
          joiner.mark();
          createSticky(b.doc, { x: 7, y: 7 });
          await joiner.waitUntil('the next note', () => joiner.notes().length === 2);
          expect(joiner.updates()).toBe(1);
        } finally {
          await disconnectClients([joiner]);
        }
      } finally {
        await disconnectClients([a, b]);
      }
    });
  });

  it('TC-16 relays awareness verbatim, the sender included', async () => {
    const { a, b } = await twoClientsWithNote();
    try {
      a.mark();
      b.mark();
      const first = awarenessFrame(awarenessUpdate(1001, 1, 'Ada'));
      const second = awarenessFrame(awarenessUpdate(1001, 2, 'Ada Lovelace'));
      a.sendRaw(first);
      a.sendRaw(second);

      // Both sockets get both frames, in the same order, byte for byte: this is what
      // keeps an idle client's own watchdog from hanging up (TC-29).
      await b.waitUntil('both awareness frames', () => b.countFrames(MESSAGE_AWARENESS) >= 2);
      await a.waitUntil('the copy back to the sender', () => a.countFrames(MESSAGE_AWARENESS) >= 2);
      expect(Array.from(a.relayedAwareness())).toEqual(Array.from(b.relayedAwareness()));
      expect(Array.from(a.relayedAwareness())).toEqual(
        Array.from(new Uint8Array([...first, ...second])),
      );
      // And it stayed a relay: the room never read the awareness document.
      expect(b.updates()).toBe(0);
    } finally {
      await disconnectClients([a, b]);
    }
  });

  it('TC-18 refills a restarted room from the first client back', async () => {
    const { boardId, a, b, id } = await twoClientsWithNote('written before the restart');
    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    try {
      await a.close();
      await b.close();
      // The room's only copy of the board was in its own memory.
      await evictDurableObject(room);

      await a.open();
      await settle();
      // A alone has now put the board back: somebody joining from scratch finds it.
      const joiner = await newClient.connect(boardId);
      try {
        await joiner.waitUntil('the board out of A’s memory', () => joiner.notes().length === 1);
        expect(joiner.notes()[0]?.text).toBe('written before the restart');
      } finally {
        await disconnectClients([joiner]);
      }

      await b.open();
      await waitForConvergence([a, b]);
      expect(b.notes()[0]?.id).toBe(id);
      expect(b.notes()[0]?.text).toBe('written before the restart');
    } finally {
      await disconnectClients([a, b]);
    }
  });

  it('TC-31 keeps relaying after a participant disappears abruptly', async () => {
    const { boardId, a, b } = await twoClientsWithNote();
    try {
      b.terminate();
      await settle();
      expect(b.closes.length).toBeGreaterThan(0);
      // The room does not fall over on the update it tries to send to a dead socket.
      const id = createSticky(a.doc, { x: 1, y: 1 }, 'pink');
      if (typeof id !== 'string') throw new Error('createSticky failed');
      const joiner = await newClient.connect(boardId);
      try {
        await joiner.waitUntil('both notes', () => joiner.notes().length === 2);
        expect(joiner.notes().map((note) => note.color).sort()).toEqual(['pink', 'yellow']);
        expect(a.isOpen).toBe(true);
        // Still relaying to the sockets that are alive.
        moveObject(a.doc, id, 500, 500);
        await joiner.waitUntil('the move', () => joiner.notes().some((note) => note.x === 500));
      } finally {
        await disconnectClients([joiner]);
      }
    } finally {
      await disconnectClients([a, b]);
    }
  });
});

/** True when every client holds at least one note. */
function clientHasNotes(clients: TestClient[]): boolean {
  return clients.every((client) => client.notes().length > 0);
}
