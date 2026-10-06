/**
 * BoardRoom integration tests (TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31).
 *
 * Every client here is a real `Y.Doc` on a real WebSocket to a real BoardRoom Durable
 * Object, syncing through the real y-protocols exchange. Nothing on the collaboration path
 * is faked, so a green run means two screens really do see the same board.
 */
import { describe, expect, test } from 'vitest';
import { env } from 'cloudflare:test';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  RECONNECT_MAX_BACKOFF_MS,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';
import { MESSAGE_QUERY_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';
import { newBoardId } from '../../src/shared/board-id';
import { runRandomOps } from './random-ops';
import {
  closeAll,
  connect,
  connectToStub,
  converge,
  sameNotes,
  sameState,
  SYNC_UPDATE,
  waitFor,
  type RoomClient,
} from './ws-client';

/** The story's stress size: a board full of notes (story 1's maximum). */
const FULL_BOARD_NOTES = 100;

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** Lets in-flight frames arrive before an assertion is made. */
function rest(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Counts update frames a client received after index `since`. */
function updatesAfter(client: RoomClient, since: number): number {
  return client.frames
    .slice(since)
    .filter((frame) => frame.kind === 'sync' && frame.syncType === SYNC_UPDATE).length;
}

const notesOf = (client: RoomClient): string => JSON.stringify(client.notes());
const idsOf = (client: RoomClient): string[] =>
  client
    .notes()
    .map((note) => note.id)
    .sort();

/** Connects two synced participants on a fresh board. */
async function pair(): Promise<{ a: RoomClient; b: RoomClient; boardId: string }> {
  const boardId = newBoardId();
  const a = await connect(boardId);
  const b = await connect(boardId);
  await Promise.all([a.waitForSync(), b.waitForSync()]);
  await converge([a, b]);
  await rest(50); // let the handshake settle, so frame counts start from a quiet board
  return { a, b, boardId };
}

describe('one change reaches every screen (TC-07, TC-08)', () => {
  test('TC-07: a note created on A appears on B within the latency budget', async () => {
    const { a, b } = await pair();
    try {
      const since = b.frames.length;
      const started = Date.now();
      createSticky(a.doc, { x: 120, y: 80 });
      await waitFor(() => b.notes().length === 1, LIVE_UPDATE_LATENCY_BUDGET_MS);
      const elapsed = Date.now() - started;
      console.info(`TC-07 measured propagation latency: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(LIVE_UPDATE_LATENCY_BUDGET_MS);

      await converge([a, b]);
      expect(notesOf(b)).toBe(notesOf(a));
      // exactly one message carried the change
      expect(updatesAfter(b, since)).toBe(1);
    } finally {
      closeAll([a, b]);
    }
  });

  const mutations: { readonly name: string; readonly apply: (doc: Y.Doc, id: string) => void }[] = [
    { name: 'move', apply: (doc, id) => void moveObject(doc, id, 420, 260) },
    { name: 'recolour', apply: (doc, id) => void setStickyColor(doc, id, 'violet') },
    {
      name: 'text insert',
      apply: (doc, id) => void getStickyText(doc, id)?.insert(0, 'typed on A '),
    },
    { name: 'delete', apply: (doc, id) => void deleteObject(doc, id) },
  ];

  for (const mutation of mutations) {
    test(`TC-08: a ${mutation.name} on A reaches B and is never echoed back to A`, async () => {
      const { a, b } = await pair();
      try {
        const id = createSticky(a.doc, { x: 60, y: 60 });
        if (mutation.name !== 'delete') {
          id && getStickyText(a.doc, id)?.insert(0, 'hello');
        }
        await converge([a, b]);
        await rest(50);

        const aSince = a.frames.length;
        const bSince = b.frames.length;
        mutation.apply(a.doc, id);
        await converge([a, b]);
        await rest(50);

        expect(notesOf(b)).toBe(notesOf(a));
        expect(updatesAfter(b, bSince)).toBe(1);
        // the room does not send a change back to the screen it came from
        expect(updatesAfter(a, aSince)).toBe(0);
      } finally {
        closeAll([a, b]);
      }
    });
  }
});

describe('simultaneous edits merge (TC-09 to TC-11)', () => {
  test('TC-09: typing at both ends of one note keeps every character on both screens', async () => {
    const { a, b } = await pair();
    try {
      const id = createSticky(a.doc, { x: 0, y: 0 });
      const textA = getStickyText(a.doc, id);
      if (!textA) throw new Error('the note disappeared while creating it');
      textA.insert(0, 'green');
      await converge([a, b]);

      // both sides write before the other's change has arrived
      getStickyText(a.doc, id)?.insert(0, 'red ');
      getStickyText(b.doc, id)?.insert(5, ' blue');

      await converge([a, b]);
      expect(a.notes()[0]?.text).toBe('red green blue');
      expect(b.notes()[0]?.text).toBe('red green blue');
    } finally {
      closeAll([a, b]);
    }
  });

  test('TC-09: long interleaved typing loses and duplicates no characters', async () => {
    const { a, b } = await pair();
    try {
      const id = createSticky(a.doc, { x: 0, y: 0 });
      await converge([a, b]);

      const fromA = ['ship', 'demo', 'today', 'after', 'standup'];
      const fromB = ['needs', 'design', 'review', 'before', 'release'];
      for (let round = 0; round < fromA.length; round += 1) {
        const textA = getStickyText(a.doc, id);
        const textB = getStickyText(b.doc, id);
        if (!textA || !textB) throw new Error('the note disappeared while typing');
        const wordA = fromA[round] as string;
        const wordB = fromB[round] as string;
        textA.insert(textA.length, textA.length === 0 ? wordA : ` ${wordA}`);
        await rest(5);
        textB.insert(textB.length, textB.length === 0 ? wordB : ` ${wordB}`);
        await rest(5);
      }

      await converge([a, b]);
      expect(b.notes()[0]?.text).toBe(a.notes()[0]?.text);
      const words = (a.notes()[0]?.text ?? '').split(' ').filter(Boolean);
      expect(words.sort()).toEqual([...fromA, ...fromB].sort());
    } finally {
      closeAll([a, b]);
    }
  });

  test('TC-10: a concurrent move resolves to one position on both screens', async () => {
    const { a, b } = await pair();
    try {
      const id = createSticky(a.doc, { x: 0, y: 0 });
      await converge([a, b]);

      // the same property, written on both sides in the same tick
      moveObject(a.doc, id, 100, 0);
      moveObject(b.doc, id, 300, 0);

      await converge([a, b]);
      const xA = a.notes()[0]?.x;
      const xB = b.notes()[0]?.x;
      expect(xB).toBe(xA);
      expect([100, 300]).toContain(xA);
    } finally {
      closeAll([a, b]);
    }
  });

  test('TC-11: a delete wins over text typed in the note at the same time', async () => {
    const { a, b } = await pair();
    try {
      const id = createSticky(a.doc, { x: 0, y: 0 });
      await converge([a, b]);

      // A deletes while B is typing into that very note
      deleteObject(a.doc, id);
      getStickyText(b.doc, id)?.insert(0, 'typed into a deleted note');

      await converge([a, b]);
      expect(a.notes()).toHaveLength(0);
      expect(b.notes()).toHaveLength(0);
      // the typed text is nowhere on either screen
      expect(notesOf(a)).not.toContain('typed into a deleted note');
      expect(notesOf(b)).not.toContain('typed into a deleted note');
      // and neither side fell over: both are still editing normally
      createSticky(a.doc, { x: 10, y: 10 });
      await converge([a, b]);
      expect(a.notes()).toHaveLength(1);
      expect(b.errors).toEqual([]);
    } finally {
      closeAll([a, b]);
    }
  });
});

describe('many participants and many operations (TC-12, TC-14)', () => {
  test(`TC-12: ${MAX_CONCURRENT_EDITORS} participants × 200 random operations all end with the same board`, async () => {
    const boardId = newBoardId();
    const clients: RoomClient[] = [];
    try {
      for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
        const client = await connect(boardId);
        await client.waitForSync();
        clients.push(client);
      }
      await converge(clients);

      const created = new Set<string>();
      const deleted = new Set<string>();
      for (let round = 0; round < 200; round += 1) {
        for (const [index, client] of clients.entries()) {
          const seed = 1000 * (index + 1) + round;
          const counts = runRandomOps(client.doc, 1, seed);
          for (const id of counts.createdIds) created.add(id);
          for (const id of counts.deletedIds) deleted.add(id);
        }
        await rest(1);
      }
      console.info(
        `TC-12 seeds 1001.. and beyond; created ${created.size}, deleted ${deleted.size}`,
      );

      await converge(clients);
      expect(sameState(clients)).toBe(true);
      expect(sameNotes(clients)).toBe(true);
      // every note that was created and not deleted is there - nothing was lost on the way
      const expected = new Set(created);
      for (const id of deleted) expected.delete(id);
      const first = clients[0];
      if (!first) throw new Error('no clients');
      expect(idsOf(first)).toEqual([...expected].sort());
      expect(expected.size).toBeGreaterThan(20);
    } finally {
      closeAll(clients);
    }
  });

  test('TC-14: a participant who connects later sees the whole board', async () => {
    const { a, b, boardId } = await pair();
    try {
      for (let note = 0; note < 10; note += 1) {
        const idA = createSticky(a.doc, { x: note * 90, y: 40 });
        idA && getStickyText(a.doc, idA)?.insert(0, `from A ${note}`);
        const idB = createSticky(b.doc, { x: note * 90, y: 240 });
        idB && getStickyText(b.doc, idB)?.insert(0, `from B ${note}`);
      }
      await converge([a, b]);
      expect(a.notes()).toHaveLength(20);

      const late = await connect(boardId);
      await late.waitForSync();
      await converge([late, a, b]);
      expect(notesOf(late)).toBe(notesOf(a));
      closeAll([late]);
    } finally {
      closeAll([a, b]);
    }
  });

  test(`TC-14 (stress): a full board of ${FULL_BOARD_NOTES} notes reaches a late joiner`, async () => {
    const { a, b, boardId } = await pair();
    try {
      for (let note = 0; note < FULL_BOARD_NOTES; note += 1) {
        const id = createSticky(a.doc, { x: (note % 10) * 120, y: Math.floor(note / 10) * 120 });
        getStickyText(a.doc, id)?.insert(0, `note number ${note}`);
        setStickyColor(a.doc, id, COLORS[note % COLORS.length] as StickyColor);
      }
      await converge([a, b]);
      expect(b.notes()).toHaveLength(FULL_BOARD_NOTES);

      const late = await connect(boardId);
      const started = Date.now();
      await late.waitForSync();
      await waitFor(() => late.notes().length === FULL_BOARD_NOTES, LIVE_UPDATE_LATENCY_BUDGET_MS);
      const elapsed = Date.now() - started;
      console.info(`TC-14 stress: ${FULL_BOARD_NOTES} notes reached a new screen in ${elapsed}ms`);
      expect(elapsed).toBeLessThan(LIVE_UPDATE_LATENCY_BUDGET_MS);
      await converge([late, a, b]);
      expect(notesOf(late)).toBe(notesOf(a));
      closeAll([late]);
    } finally {
      closeAll([a, b]);
    }
  });
});

describe('a bad frame closes one socket (TC-15)', () => {
  const badFrames: { readonly name: string; readonly send: (client: RoomClient) => void }[] = [
    { name: 'a text frame', send: (client) => client.sendText('GET / HTTP/1.1') },
    {
      name: 'truncated bytes',
      // a sync frame that promises 40 bytes and sends two
      send: (client) => client.sendBytes(new Uint8Array([MESSAGE_SYNC, 40, 1, 2])),
    },
    {
      name: 'an unknown message type',
      send: (client) => client.sendBytes(new Uint8Array([255, 127, 3, 1, 4, 1, 5, 9])),
    },
    {
      name: 'an invalid Yjs update',
      // well framed, but the payload is not something Yjs can apply
      send: (client) => client.sendSync(new Uint8Array([SYNC_UPDATE, 3, 9, 9, 9])),
    },
  ];

  for (const bad of badFrames) {
    test(`TC-15: ${bad.name} closes only the sender`, async () => {
      const { a, b, boardId } = await pair();
      try {
        createSticky(a.doc, { x: 5, y: 5 });
        await converge([a, b]);
        await rest(50);
        const baseline = notesOf(a);
        const bSince = b.frames.length;

        const offender = await connect(boardId, {
          // a client with no document of its own, so the bad frame is all it can do
          init: false,
        });
        await offender.waitForSync();
        bad.send(offender);

        expect((await offender.waitForClose()).code).toBe(1003);
        await rest(200);

        // the other participant never noticed
        expect(b.closes).toEqual([]);
        expect(notesOf(b)).toBe(baseline);
        expect(updatesAfter(b, bSince)).toBe(0);

        // and the room still works for everybody: a new note reaches B, and a new client
        // reads the unchanged document
        createSticky(a.doc, { x: 90, y: 90 });
        await waitFor(() => b.notes().length === 2, LIVE_UPDATE_LATENCY_BUDGET_MS);
        const witness = await connect(boardId);
        await witness.waitForSync();
        await converge([witness, a, b]);
        expect(witness.notes()).toHaveLength(2);
        closeAll([witness]);
      } finally {
        closeAll([a, b]);
      }
    });
  }
});

describe('awareness is relayed, never interpreted (TC-16)', () => {
  test('TC-16: an awareness frame reaches everybody including its sender; a query is ignored', async () => {
    const { a, b } = await pair();
    try {
      const payload = new Uint8Array([0x01, 0x0a, 0x03, 0x61, 0x6e, 0x6e]); // opaque here
      const aSince = a.frames.length;
      const bSince = b.frames.length;
      a.sendAwareness(payload);

      await waitFor(() => a.frames.length > aSince && b.frames.length > bSince);
      const toA = a.frames[a.frames.length - 1];
      const toB = b.frames[b.frames.length - 1];
      expect(toA?.kind).toBe('awareness');
      expect(toB?.kind).toBe('awareness');
      // relayed byte for byte, to both of them
      expect(Array.from(toB?.bytes ?? [])).toEqual(Array.from(toA?.bytes ?? []));
      expect(Array.from(toB?.bytes ?? [])).toEqual(
        Array.from(new Uint8Array([1, payload.length, ...payload])),
      );

      // a query for the awareness state changes nothing: the room keeps none
      const aCount = a.frames.length;
      const bCount = b.frames.length;
      a.sendBytes(new Uint8Array([MESSAGE_QUERY_AWARENESS]));
      await rest(300);
      expect(a.frames.length).toBe(aCount);
      expect(b.frames.length).toBe(bCount);
      expect(a.closes).toEqual([]);
      expect(b.closes).toEqual([]);
    } finally {
      closeAll([a, b]);
    }
  });
});

describe('reconnecting to the same room (TC-18 and live.catch_up)', () => {
  test('TC-18: after a room restart the first client back refills the room', async () => {
    // rooms that only exist in this test; the "restart" is a brand new instance, exactly
    // what the runtime hands out after an eviction or a deploy
    const before = env.BOARD_ROOM.newUniqueId();
    const a = await connectToStub(env.BOARD_ROOM.get(before));
    await a.waitForSync();
    for (let note = 0; note < 5; note += 1) {
      createSticky(a.doc, { x: note * 50, y: note * 50 });
    }
    const b = await connectToStub(env.BOARD_ROOM.get(before));
    await b.waitForSync();
    await converge([a, b]);
    closeAll([a, b]);
    await rest(50);

    // fresh instance: empty document, nobody connected
    const after = env.BOARD_ROOM.newUniqueId();
    const aBack = await connectToStub(env.BOARD_ROOM.get(after), { doc: a.doc });
    await aBack.waitForSync();
    const bBack = await connectToStub(env.BOARD_ROOM.get(after), { doc: b.doc });
    await bBack.waitForSync();
    await converge([aBack, bBack]);

    // A reconnecting first is enough: the room repopulated from A and B caught up from it
    expect(bBack.notes()).toHaveLength(5);
    const witness = await connectToStub(env.BOARD_ROOM.get(after));
    await witness.waitForSync();
    await converge([witness, aBack, bBack]);
    expect(witness.notes()).toHaveLength(5);
    closeAll([aBack, bBack, witness]);
  });

  test('live.catch_up: notes made while the socket is down arrive when it comes back', async () => {
    const { a, b, boardId } = await pair();
    try {
      a.close(1001, 'tab went to sleep');
      await waitFor(() => a.closes.length > 0, 5000, 'the socket never reported the close');
      await rest(100); // the room notices the socket is gone

      for (let note = 0; note < 12; note += 1) {
        createSticky(
          a.doc,
          { x: note * 40, y: note * 30 },
          COLORS[note % COLORS.length] as StickyColor,
        );
      }
      expect(b.notes()).toHaveLength(0); // nothing could have arrived while A was away

      const back = await connect(boardId, { doc: a.doc });
      await back.waitForSync();
      await converge([back, b]);
      expect(b.notes()).toHaveLength(12);
      expect(notesOf(back)).toBe(notesOf(b));
      closeAll([back]);
    } finally {
      closeAll([a, b]);
    }
  });

  test('live.catch_up: a reconnect inside the backoff window leaves no gap and no duplicates', async () => {
    const { a, b, boardId } = await pair();
    try {
      const ids = [1, 2, 3].map((n) => createSticky(a.doc, { x: n * 60, y: 20 }));
      await converge([a, b]);
      await rest(50);

      const started = Date.now();
      a.close(1001, 'network hiccup');
      await waitFor(() => a.closes.length > 0, 5000, 'the socket never reported the close');
      const back = await connect(boardId, { doc: a.doc });
      // the whole drop-and-recover happened well inside the reconnect budget
      expect(Date.now() - started).toBeLessThan(RECONNECT_MAX_BACKOFF_MS);

      await back.waitForSync();
      await converge([back, b]);
      // no gap and no duplicate: the same three notes are there, once each
      expect(idsOf(back)).toEqual([...ids].sort());
      expect(idsOf(b)).toEqual([...ids].sort());
      closeAll([back]);
    } finally {
      closeAll([a, b]);
    }
  });
});

describe('a dead socket does not break the room (TC-31)', () => {
  test('TC-31: sending to a socket that died mid-broadcast leaves the room working', async () => {
    const { a, b, boardId } = await pair();
    try {
      // B's socket goes away at the same moment A changes something: the room is holding B
      // in its socket set while it broadcasts
      b.close(1001, 'abruptly gone');
      createSticky(a.doc, { x: 30, y: 30 });
      await rest(200);

      // the room neither threw nor stopped relaying: a later client gets the change
      const later = await connect(boardId);
      await later.waitForSync();
      await converge([a, later]);
      expect(later.notes()).toHaveLength(1);
      expect(later.errors).toEqual([]);
      closeAll([later]);
    } finally {
      closeAll([a, b]);
    }
  });
});
