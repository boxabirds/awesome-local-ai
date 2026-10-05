/**
 * Integration tests for the room a board lives in (sync.room).
 *
 * Real Durable Object, real WebSockets, real Yjs. The only thing simulated is the
 * browser, and even that is a second implementation of the client half of the protocol
 * rather than a stand-in for the room. These are the tests that hold the story's actual
 * promise: that a change on one screen arrives on every other screen of the same board,
 * and that two people typing at the same time keep both people's typing.
 */
import { describe, expect, it } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import { CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { MAX_CONCURRENT_EDITORS, STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import { describeSeed, randomOps } from './helpers/random-ops';
import {
  awarenessFrames,
  connect,
  converge,
  createNote,
  malformed,
  leave,
  moveTo,
  noteById,
  onlyNote,
  recolour,
  removeNote,
  settle,
  textOf,
  typeInto,
  type BoardClient,
} from './helpers/ws-client';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

describe('a change reaching the rest of the board', () => {
  it('gives a new note to everyone else on the board (TC-07)', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    const sam = await connect(board);
    try {
      const note = createNote(alex, { x: 120, y: 240 }, 'violet');

      await converge([alex, sam]);
      expect(sam.snapshot()).toEqual(alex.snapshot());
      expect(onlyNote(sam).color).toBe('violet');
      expect(noteById(sam, note)?.id).toBe(note);
      // Exactly one frame carried the new note: the room does not send a change twice.
      expect(sam.countOf('update')).toBe(1);
    } finally {
      leave(alex, sam);
    }
  });

  // One test per kind of change, because a change that syncs by accident — arriving as
  // part of a later sync — is not the same as one that syncs live.
  const changes: { name: string; change: (client: BoardClient, id: string) => void; notes: number }[] = [
    { name: 'move', change: (client, id) => void moveTo(client, id, 400, 500), notes: 1 },
    { name: 'recolour', change: (client, id) => void recolour(client, id, 'blue'), notes: 1 },
    { name: 'typing', change: (client, id) => typeInto(client, id, 0, 'Draft: '), notes: 1 },
    { name: 'delete', change: (client, id) => void removeNote(client, id), notes: 0 },
  ];
  for (const { name, change, notes } of changes) {
    it(`sends a ${name} to the rest of the board and not back to its author (TC-08)`, async () => {
      const board = newBoardId();
      const alex = await connect(board);
      const sam = await connect(board);
      try {
        const note = createNote(alex, { x: 10, y: 20 }, 'yellow');
        await converge([alex, sam]);
        // Whatever traffic the board was still finishing when it settled; the point is
        // that the change below adds none of it to the author's own screen.
        const before = alex.countOf('update');

        change(alex, note);
        await converge([alex, sam]);

        expect(sam.snapshot()).toEqual(alex.snapshot());
        expect(alex.snapshot()).toHaveLength(notes);
        // Nobody is sent their own work back: a change gets one trip round the board.
        expect(alex.countOf('update')).toBe(before);
      } finally {
        leave(alex, sam);
      }
    });
  }

  it('keeps both people typing in the same note (TC-09)', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    const note = createNote(alex);
    typeInto(alex, note, 0, 'green');
    const sam = await connect(board);
    await converge([alex, sam]);
    expect(textOf(sam, note)).toBe('green');

    // Both type before either has heard about the other, one at each end of the same
    // word. A last-write-wins board would lose one of these two edits.
    typeInto(alex, note, 0, 'red ');
    typeInto(sam, note, 5, ' blue');

    await converge([alex, sam]);
    expect(textOf(alex, note)).toBe('red green blue');
    expect(textOf(sam, note)).toBe('red green blue');
    leave(alex, sam);
  });

  it('settles a disagreement about where a note is in one place for everyone (TC-10)', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    const note = createNote(alex, { x: 0, y: 0 });
    const sam = await connect(board);
    await converge([alex, sam]);

    moveTo(alex, note, 100, 100);
    moveTo(sam, note, 300, 100);

    await converge([alex, sam]);
    // Which of the two wins is Yjs's to decide; that both screens decide the same is the
    // whole of the guarantee, so this says "identical", not "300".
    expect(onlyNote(alex).x).toBe(onlyNote(sam).x);
    expect([100, 300]).toContain(onlyNote(alex).x);
    leave(alex, sam);
  });

  it('lets a delete win over typing in the note being deleted (TC-11)', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    const note = createNote(alex, { x: 5, y: 5 });
    typeInto(alex, note, 0, 'old text');
    const sam = await connect(board);
    await converge([alex, sam]);

    // Alex deletes the note at the moment Sam types into it.
    removeNote(alex, note);
    typeInto(sam, note, 8, ' added by sam');

    await converge([alex, sam]);
    // The note is gone from both screens and its text is nowhere: a delete is not
    // undone by somebody typing into what they still think is there.
    expect(noteById(alex, note)).toBeUndefined();
    expect(noteById(sam, note)).toBeUndefined();
    expect(textOf(sam, note)).toBe('');
    // The room is not upset by it: a note made afterwards still reaches everybody.
    const later = createNote(alex);
    await converge([alex, sam]);
    expect(noteById(sam, later)?.id).toBe(later);
    leave(alex, sam);
  });

  it('brings everyone to the same board after two hundred edits each (TC-12)', async () => {
    const seed = 20260822;
    const count = 200;
    // Log the input, because the only way to fix a convergence failure is to be able to
    // make the same one again.
    console.log(`TC-12 ${describeSeed(seed, count)}, ${MAX_CONCURRENT_EDITORS} clients`);

    const board = newBoardId();
    const clients: BoardClient[] = [];
    try {
      for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
        clients.push(await connect(board));
      }
      // Every client makes every edit, with no waiting in between: each one's changes
      // are still travelling while the others make theirs.
      const ops = randomOps(seed, count);
      for (const op of ops) {
        for (const client of clients) op.apply(client.doc);
      }

      await converge(clients, 20_000);
      const expected = clients[0].snapshot();
      for (const client of clients) expect(client.snapshot()).toEqual(expected);
      // A board that ended up empty would not have tested much.
      expect(expected.length).toBeGreaterThan(0);
    } finally {
      for (const client of clients) client.close();
    }
  }, 90_000);

  it('gives a late joiner the whole board (TC-14)', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    const sam = await connect(board);
    try {
      for (let index = 0; index < 20; index += 1) {
        createNote(alex, { x: index * 40, y: index * 30 }, COLORS[index % COLORS.length]);
        createNote(sam, { x: 1000 + index * 40, y: index * 30 }, COLORS[index % COLORS.length]);
      }
      await converge([alex, sam]);
      expect(alex.snapshot()).toHaveLength(40);

      const late = await connect(board);
      try {
        expect(late.snapshot()).toEqual(alex.snapshot());
      } finally {
        late.close();
      }
    } finally {
      leave(alex, sam);
    }
  }, 30_000);
});

describe('bad data on one connection', () => {
  const bad = [
    { name: 'a text frame', frame: malformed.text },
    { name: 'presence bytes that stop short', frame: malformed.truncatedAwareness },
    { name: 'a sync frame that stops short', frame: malformed.truncatedSync },
    { name: 'a message type nobody defined', frame: malformed.unknownType },
    { name: 'a document update that is not one', frame: malformed.invalidUpdate },
    { name: 'an empty frame', frame: malformed.empty },
  ];

  for (const { name, frame } of bad) {
    it(`closes the connection that sent ${name} and disturbs nobody else (TC-15)`, async () => {
      const board = newBoardId();
      const guilty = await connect(board);
      const innocent = await connect(board);
      try {
        const note = createNote(innocent, { x: 1, y: 2 });
        await converge([guilty, innocent]);

        guilty.sendRaw(frame);

        const closed = await guilty.waitForClose();
        expect(closed.code).toBe(CLOSE_UNSUPPORTED_DATA);
        // The rest of the board does not notice: same notes, nothing lost.
        expect(innocent.open).toBe(true);
        expect(onlyNote(innocent).id).toBe(note);

        // And the board keeps working, both for the person who stayed and for somebody
        // who arrives afterwards.
        moveTo(innocent, note, 90, 90);
        const witness = await connect(board);
        await converge([innocent, witness]);
        expect(onlyNote(witness).x).toBe(90);
        witness.close();
      } finally {
        leave(guilty, innocent);
      }
    });
  }
});

describe('presence and reconnection', () => {
  it('relays presence bytes to everyone, the sender included (TC-16)', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    const sam = await connect(board);
    try {
      alex.awareness.setLocalStateField('user', 'Alex');

      await sam.waitFor('to be told who Alex is', () => sam.awareness.getStates().has(alex.clientId()));
      // The sender is given the same chance to have heard its own presence back before the two
      // logs are compared. The room writes both copies in one turn, but the two sockets are
      // separate connections and nothing orders one against the other; comparing as soon as
      // the second person has heard only ever proved the room is quick.
      await alex.waitFor('to hear its own presence back', () => alex.countOf('awareness') >= sam.countOf('awareness'));
      // The same bytes on both screens: presence is relayed, not translated.
      expect(awarenessFrames(sam)).toEqual(awarenessFrames(alex));
      expect(awarenessFrames(alex).length).toBeGreaterThan(0);
      expect(sam.awareness.getStates().get(alex.clientId())).toEqual({ user: 'Alex' });
      // The sender hears its own presence come back. That round trip is what stops an
      // idle connection being declared dead 45 seconds into a quiet meeting.
      expect(alex.countOf('awareness')).toBeGreaterThan(0);
    } finally {
      leave(alex, sam);
    }
  });

  it('is filled back in by the first client to come back (TC-18)', async () => {
    // The room holds the document in memory only, so what matters when it starts from
    // nothing is that the first client back gives it the whole board. A room for a board
    // id nobody has used yet starts exactly as a restarted one does: empty.
    const board = newBoardId();
    const alex = await connect(board);
    const first = createNote(alex, { x: 7, y: 7 }, 'pink');
    typeInto(alex, first, 0, 'kept');
    const sam = await connect(board);
    await converge([alex, sam]);

    // Everybody leaves, and Alex goes on editing with nothing to send to: this is what
    // a reconnecting client carries back, and what a room that forgot everything needs.
    alex.disconnect();
    sam.disconnect();
    await settle();
    const second = createNote(alex, { x: 900, y: 900 }, 'green');
    moveTo(alex, first, 500, 500);

    // Alex comes back first and brings the room up to date.
    await alex.reconnect(board);
    const witness = await connect(board);
    expect(witness.snapshot()).toEqual(alex.snapshot());
    expect(witness.snapshot()).toHaveLength(2);

    // Sam, left behind at the older state, is caught up as well.
    await sam.reconnect(board);
    await converge([alex, sam, witness]);
    expect(noteById(sam, second)?.color).toBe('green');
    expect(noteById(sam, first)?.x).toBe(500);
    witness.close();
    leave(alex, sam);
  }, 30_000);

  it('survives a socket that died mid-broadcast and keeps serving later ones (TC-31)', async () => {
    const board = newBoardId();
    const alex = await connect(board);
    const sam = await connect(board);
    try {
      // Sam's connection dies without the room having noticed yet...
      sam.ws.close();
      // ...and Alex changes the board at that exact moment.
      const note = createNote(alex, { x: 3, y: 4 });

      // The room neither throws nor stops: the change reaches the next person in.
      const later = await connect(board);
      await converge([alex, later]);
      expect(onlyNote(later).id).toBe(note);

      // And nothing further is sent down the dead socket.
      const frames = sam.log.length;
      createNote(alex, { x: 5, y: 6 });
      await converge([alex, later]);
      expect(sam.log.length).toBe(frames);
      expect(later.snapshot()).toHaveLength(2);
      later.close();
    } finally {
      leave(alex, sam);
    }
  });
});
