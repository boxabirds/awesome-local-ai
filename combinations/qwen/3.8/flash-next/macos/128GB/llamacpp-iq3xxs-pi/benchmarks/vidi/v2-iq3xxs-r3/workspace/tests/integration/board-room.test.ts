/**
 * TC-07 to TC-12, TC-14 to TC-16, TC-18 and TC-31 — the BoardRoom Durable
 * Object (sync.room) under real workerd: real sockets, real `Y.Doc`s, real
 * y-protocols framing, no mocks and no test-only seams in the room.
 *
 * "B received exactly one update" and "A got no echo" are counted from the
 * frames each client receives, after waiting for the wire to go quiet — a count
 * taken too early means "so far", not "all of it".
 */
import { abortAllDurableObjects } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';

import { formatReport, makeRng, newReport, randomEdit, STICKY_COLOR_NAMES } from './random-ops';
import {
  BoardClient,
  closed,
  createNote,
  deleteNote,
  moveNote,
  recolourNote,
  settle,
  synced,
  typeInNote,
  waitFor,
} from './ws-client';

import type { StickySnapshot } from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';

/** Two participants of one board, both synced with the room and each other. */
async function pair(): Promise<{ boardId: string; a: BoardClient; b: BoardClient }> {
  const boardId = newBoardId();
  const a = await BoardClient.join(boardId);
  await synced(a);
  const b = await BoardClient.join(boardId);
  await synced(b);
  return { boardId, a, b };
}

/** A third opinion, in the form of a client that joins later. */
async function join(boardId: string): Promise<BoardClient> {
  const client = await BoardClient.join(boardId);
  await synced(client);
  return client;
}

/** Wait for one note to appear on `client`, and hand back its notes. */
async function notesOf(client: BoardClient, count: number): Promise<readonly StickySnapshot[]> {
  await waitFor(
    `${count} note(s) on a client`,
    () => client.notes().length === count,
  );
  await settle(client);
  return client.notes();
}

/** One note, created by A and seen by B; the starting point of most cases. */
async function sharedNote(): Promise<{
  boardId: string;
  a: BoardClient;
  b: BoardClient;
  id: string;
  note: StickySnapshot;
}> {
  const { boardId, a, b } = await pair();
  const id = createNote(a, { x: 300, y: 200 });
  const notes = await notesOf(b, 1);
  return { boardId, a, b, id, note: notes[0] as StickySnapshot };
}

describe('a change reaches the other client (TC-07)', () => {
  it('gives B the same note A created, as exactly one update', async () => {
    const { a, b } = await pair();
    const updatesBefore = b.received.updates;

    createNote(a, { x: 120, y: 80 });

    await waitFor('B to receive an update', () => b.received.updates > updatesBefore);
    await settle(b);
    expect(b.received.updates - updatesBefore).toBe(1);
    expect(b.notes()).toEqual(a.notes());
    expect(b.notes()).toHaveLength(1);
    a.leave();
    b.leave();
  });
});

describe('the four kinds of change (TC-08)', () => {
  it('moves a note', async () => {
    const { a, b, id } = await sharedNote();
    const updatesBefore = b.received.updates;
    const echoesBefore = a.received.updates;

    moveNote(a, id, 512, -64);

    await waitFor('the move on B', () => (b.notes()[0]?.x ?? 0) === 512);
    await settle(b);
    expect(b.notes()).toEqual(a.notes());
    expect(b.received.updates - updatesBefore).toBe(1);
    // The sender already has it: an echo would be a second round trip for free.
    expect(a.received.updates).toBe(echoesBefore);
    a.leave();
    b.leave();
  });

  it('recolours a note', async () => {
    const { a, b, id, note } = await sharedNote();
    const echoesBefore = a.received.updates;
    // Another one of the four colours the product offers, whatever the note
    // happens to have now.
    const next = STICKY_COLOR_NAMES.find((color) => color !== note.color) as StickyColor;

    recolourNote(a, id, next);

    await waitFor('the colour on B', () => b.notes()[0]?.color === next);
    await settle(b);
    expect(b.notes()).toEqual(a.notes());
    expect(a.received.updates).toBe(echoesBefore);
    a.leave();
    b.leave();
  });

  it('types into a note', async () => {
    const { a, b, id } = await sharedNote();
    const echoesBefore = a.received.updates;

    typeInNote(a, id, 'harbour');

    await waitFor('the text on B', () => b.notes()[0]?.text === 'harbour');
    await settle(b);
    expect(b.notes()[0]?.text).toBe('harbour');
    expect(b.notes()).toEqual(a.notes());
    expect(a.received.updates).toBe(echoesBefore);
    a.leave();
    b.leave();
  });

  it('deletes a note', async () => {
    const { a, b, id } = await sharedNote();
    const echoesBefore = a.received.updates;

    expect(deleteNote(a, id)).toBe(true);

    await waitFor('the note to disappear on B', () => b.notes().length === 0);
    await settle(b);
    expect(b.notes()).toEqual([]);
    expect(a.notes()).toEqual([]);
    expect(a.received.updates).toBe(echoesBefore);
    a.leave();
    b.leave();
  });
});

describe('two people at the same time (TC-09, TC-10)', () => {
  it('keeps every character of simultaneous typing, in one order on both screens', async () => {
    const { a, b, id } = await sharedNote();
    typeInNote(a, id, 'green'); // 'green' on both
    await waitFor('green on B', () => b.notes()[0]?.text === 'green');
    await settle(b);

    // Neither edit has been exchanged yet: both are made before the wire moves.
    typeInNote(a, id, 'red ', 0);
    typeInNote(b, id, ' blue', (b.notes()[0]?.text ?? '').length);

    await settle(a);
    await settle(b);
    const textA = a.notes()[0]?.text;
    expect(textA).toBe('red green blue');
    expect(b.notes()[0]?.text).toBe(textA);
    expect(b.notes()).toEqual(a.notes());
    a.leave();
    b.leave();
  });

  it('settles concurrent position changes on one value, the same on both', async () => {
    const { a, b, id } = await sharedNote();

    moveNote(a, id, 100, 20);
    moveNote(b, id, 300, 20);

    await settle(a);
    await settle(b);
    const xA = a.notes()[0]?.x;
    expect([100, 300]).toContain(xA);
    expect(b.notes()[0]?.x).toBe(xA);
    expect(b.notes()).toEqual(a.notes());
    a.leave();
    b.leave();
  });
});

describe('a note deleted while somebody edits it (TC-11, negative)', () => {
  it('stays deleted, and the text typed into it lands nowhere', async () => {
    const { a, b, id } = await sharedNote();

    // Concurrent on purpose: A deletes, B types in the same note.
    deleteNote(a, id);
    expect(typeInNoteSucceeded(b, id)).toBe(true);

    await settle(a);
    await settle(b);
    expect(a.notes()).toEqual([]);
    expect(b.notes()).toEqual([]);
    // Nothing was resurrected, and the typing did not create a note either.
    const allText = [...a.notes(), ...b.notes()].map((note) => note.text).join(' | ');
    expect(allText).not.toContain('un resurrected');
    expect(a.objects().size).toBe(0);
    expect(b.objects().size).toBe(0);
    a.leave();
    b.leave();
  });
});

/** B types into the note it still has, and reports that the local edit worked. */
function typeInNoteSucceeded(client: BoardClient, id: string): boolean {
  try {
    typeInNote(client, id, 'un resurrected');
    return true;
  } catch {
    return false;
  }
}

describe(`everyone converges (${MAX_CONCURRENT_EDITORS} clients, 200 edits each) (TC-12)`, () => {
  it('ends with identical snapshots after the seeded mix', async () => {
    const seed = 20_260_410;
    const boardId = newBoardId();
    const clients: BoardClient[] = [];
    try {
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) clients.push(await join(boardId));
      const rngs = clients.map((_, i) => makeRng(seed + i));
      const reports = clients.map((_, i) => newReport(seed + i));

      // Interleaved: every client edits before any of the frames are exchanged,
      // so the merges are real concurrency and not one long history.
      for (let round = 0; round < 200; round += 1) {
        clients.forEach((client, index) => randomEdit(client, rngs[index] as () => number, reports[index] as never));
        if (round % 40 === 39) for (const client of clients) await settle(client, 20, 1);
      }
      for (const client of clients) await settle(client);

      // Everything a later reader needs to reproduce the run is in this message:
      // the seed, and what each client's generator did with it.
      const summary = `seed=${seed} ${reports.map((report) => formatReport(report)).join(' | ')}`;
      console.log(`[TC-12] ${MAX_CONCURRENT_EDITORS} clients converged`, summary);
      const first = clients[0]?.notes();
      expect(first?.length ?? 0).toBeGreaterThan(0);
      for (const client of clients.slice(1)) expect(client.notes(), summary).toEqual(first);
    } finally {
      for (const client of clients) client.leave();
    }
  });
});

describe('a late joiner (TC-14)', () => {
  it('is told about every note the others made before it arrived', async () => {
    const { boardId, a, b } = await pair();
    for (let i = 0; i < 20; i += 1) {
      createNote(a, { x: i * 40, y: 0 });
      createNote(b, { x: 0, y: i * 40 });
    }
    await settle(a);
    await settle(b);
    expect(a.notes()).toHaveLength(40);
    expect(b.notes()).toHaveLength(40);

    const late = await join(boardId);
    try {
      expect(late.notes()).toHaveLength(40);
      expect(late.notes()).toEqual(a.notes());
    } finally {
      late.leave();
      a.leave();
      b.leave();
    }
  });
});

describe('traffic the room cannot use (TC-15, error path)', () => {
  const badTraffic: { readonly name: string; readonly send: (client: BoardClient) => void }[] = [
    { name: 'a text frame', send: (client) => client.sendRaw('hello from a browser console') },
    { name: 'a truncated sync frame', send: (client) => client.sendRaw(Uint8Array.from([0])) },
    { name: 'an unknown message type', send: (client) => client.sendRaw(Uint8Array.from([9, 1, 2, 3, 4])) },
    { name: 'an unknown sync type', send: (client) => client.sendRaw(Uint8Array.from([0, 7])) },
    {
      name: 'bytes that are not a Yjs update',
      send: (client) => client.sendRaw(Uint8Array.from([0, 2, 7, 1, 2, 3, 4, 5, 6, 7, 8, 9])),
    },
  ];

  for (const bad of badTraffic) {
    it(`${bad.name}: its sender is dropped, the room and everybody else are untouched`, async () => {
      const { boardId, a, b, note } = await sharedNote();
      const before = b.notes();
      expect(before).toEqual([note]);

      bad.send(a);

      const close = await closed(a);
      expect(close.code).toBe(CLOSE_UNSUPPORTED_DATA);
      await settle(b);
      // The victim is still connected and sees exactly what it saw before.
      expect(b.open).toBe(true);
      expect(b.notes()).toEqual(before);

      // And the room still relays: a person who joins now is told about the
      // notes that were already there, and their own change reaches the one who
      // is still connected.
      const joiner = await join(boardId);
      try {
        expect(joiner.notes()).toEqual(before);
        const latecomer = createNote(joiner, { x: 7, y: 7 });
        await waitFor('the room to relay again', () => b.notes().length === before.length + 1);
        expect(b.notes().map((n) => n.id)).toContain(latecomer);
      } finally {
        joiner.leave();
        b.leave();
      }
    });
  }
});

describe('awareness (TC-16)', () => {
  it('relays the bytes verbatim to everybody, the sender included', async () => {
    const { a, b } = await pair();
    // Story 6 puts presence in here; this story only carries the bytes, and
    // that relay is also what keeps an idle client from timing out (TC-29).
    a.awareness.setLocalStateField('cursor', { x: 3, y: 4 });
    a.sendAwareness();

    await waitFor('awareness on both', () => a.received.awareness >= 1 && b.received.awareness >= 1);
    await settle(a);
    await settle(b);
    expect(a.received.awareness).toBe(1);
    expect(b.received.awareness).toBe(1);
    const fromA = a.received.awarenessBytes[0];
    const fromB = b.received.awarenessBytes[0];
    expect(fromA).toBeDefined();
    expect(fromB).toEqual(fromA);
    // What came back is what A sent: not a re-encoding of it.
    a.awareness.setLocalStateField('cursor', { x: 5, y: 6 });
    a.sendAwareness();
    await waitFor('a second awareness frame', () => a.received.awareness >= 2);
    await settle(a);
    expect(a.received.awarenessBytes[1]).not.toEqual(fromA);
    a.leave();
    b.leave();
  });

  it('ignores a query for awareness instead of answering it', async () => {
    const { a, b } = await pair();
    const framesBefore = a.frames;
    a.sendQueryAwareness();
    await settle(a);
    await settle(b);
    expect(a.received.awareness).toBe(0);
    expect(b.received.awareness).toBe(0);
    expect(a.frames).toBe(framesBefore);
    a.leave();
    b.leave();
  });
});

describe('a room that lost everything (TC-18)', () => {
  it('is refilled by the first client back, and stays identical for everybody', async () => {
    const { boardId, a, b } = await pair();
    createNote(a, { x: 10, y: 10 });
    createNote(b, { x: 20, y: 20 });
    await settle(a);
    await settle(b);
    const before = a.notes();
    expect(before).toHaveLength(2);
    const docA = a.doc;
    const docB = b.doc;
    const gone = Promise.all([closed(a), closed(b)]);
    a.leave();
    b.leave();
    await gone;

    // The room instance is thrown away: this is a deploy, an eviction, or a
    // restart — the document is gone with it (nothing is persisted until 4).
    await abortAllDurableObjects();

    // The first client back has nowhere to catch up from, so it *gives* the
    // room its own state instead of being emptied by the room.
    const back = await BoardClient.join(boardId, docA);
    await synced(back);
    expect(back.notes()).toEqual(before);

    // A newcomer is told everything the room now knows.
    const joiner = await join(boardId);
    expect(joiner.notes()).toEqual(before);

    // And the other client of the old room reconnects to a room that holds both
    // of its own notes and the ones it had seen.
    const other = await BoardClient.join(boardId, docB);
    await synced(other);
    await settle(other);
    expect(other.notes()).toEqual(before);
    expect(joiner.notes()).toEqual(before);

    joiner.leave();
    other.leave();
    back.leave();
  });
});

describe('a socket that died mid-broadcast (TC-31, error path)', () => {
  it('neither stops the room nor loses the change for anybody else', async () => {
    const { boardId, a, b } = await pair();
    const c = await join(boardId);
    const seenByC = c.received.frames;

    // B goes away without saying goodbye, and the next change is sent while the
    // room may still believe B is there: a send that throws must cost that
    // socket only.
    b.leave(1011, 'tab closed');
    const id = createNote(a, { x: 1, y: 1 });

    await waitFor('C to get the note', () => c.notes().some((note) => note.id === id));
    expect(c.received.frames).toBeGreaterThan(seenByC);
    expect(a.open).toBe(true);

    // The room keeps working after it dropped the dead socket.
    const late = await join(boardId);
    expect(late.notes().map((note) => note.id)).toContain(id);
    createNote(a, { x: 2, y: 2 });
    await waitFor('two notes on C', () => c.notes().length === 2);
    await settle(c);
    await settle(late);
    expect(late.notes()).toEqual(c.notes());

    late.leave();
    c.leave();
    a.leave();
    b.leave();
  });
});
