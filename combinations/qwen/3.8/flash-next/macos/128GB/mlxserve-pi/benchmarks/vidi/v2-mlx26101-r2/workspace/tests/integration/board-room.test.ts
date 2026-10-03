import { describe, expect, it } from 'vitest';

import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model.js';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config.js';
import { CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol.js';
import { newBoardId } from '../../src/shared/board-id.js';
import {
  awarenessFrame,
  brokenUpdateFrame,
  eventually,
  syncedClient,
  syncStep1Frame,
  textOf,
  type Client,
} from './ws-client.js';
import {
  describeDifference,
  newSeed,
  runSeededOps,
  sameBoard,
} from './random-ops.js';

/**
 * TC-07 to TC-18 and TC-31 (design "BoardRoom Durable Object"): the room with
 * real WebSockets and real Yjs, driven by clients that speak the browser
 * provider's protocol. TC-13 and TC-17 are in `worker.test.ts`, where the design
 * puts them.
 *
 * Every board id comes from `newBoardId()`, so no test can disturb another: rooms
 * live on in the Worker instance for the whole run.
 */

/** Two synced clients and one note they both already have. */
async function pair(): Promise<{ a: Client; b: Client; noteId: string; boardId: string }> {
  const boardId = newBoardId();
  const a = await syncedClient(boardId);
  const b = await syncedClient(boardId);
  const noteId = createSticky(a.doc, { x: 400, y: 300 }) as string;
  await eventually(() => expect(b.snapshot()).toHaveLength(1), {
    what: 'the note reaches B',
  });
  return { a, b, noteId, boardId };
}

/** A console error collector, for the tests that must not produce one. */
function collectConsoleErrors(): { errors: unknown[]; restore(): void } {
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    errors.push(args);
  };
  return { errors, restore: () => (console.error = original) };
}

describe('BoardRoom document and relay', () => {
  it('TC-07 carries a new sticky note to the other person as one update', async () => {
    const boardId = newBoardId();
    const a = await syncedClient(boardId);
    const b = await syncedClient(boardId);

    const seen = b.mark();
    createSticky(a.doc, { x: 120, y: 80 });

    // Exactly one message, and it is an update.
    const frame = await b.expectMessage();
    expect(b.kinds(seen)).toEqual(['update']);
    expect(frame[0]).toBe(0);

    await eventually(() => expect(b.snapshot()).toEqual(a.snapshot()), {
      what: 'B sees what A created',
    });
    expect(b.snapshot()).toHaveLength(1);
  });

  it('TC-08 moves a note for the other person, with no echo back', async () => {
    const { a, b, noteId } = await pair();
    const seen = b.mark();

    moveObject(a.doc, noteId, 900, 640);

    await b.expectMessage();
    expect(b.kinds(seen)).toEqual(['update']);
    expect(b.snapshot()[0]).toMatchObject({ x: 900, y: 640 });
    expect(b.snapshot()).toEqual(a.snapshot());
    // The sender is never shown its own change coming back.
    await a.expectNothing(300);
  });

  it('TC-08 recolours a note for the other person, with no echo back', async () => {
    const { a, b, noteId } = await pair();
    const seen = b.mark();

    setStickyColor(a.doc, noteId, 'violet');

    await b.expectMessage();
    expect(b.kinds(seen)).toEqual(['update']);
    expect(b.snapshot()[0]?.color).toBe('violet');
    expect(b.snapshot()).toEqual(a.snapshot());
    await a.expectNothing(300);
  });

  it('TC-08 carries typed text to the other person, with no echo back', async () => {
    const { a, b, noteId } = await pair();
    const seen = b.mark();

    const text = getStickyText(a.doc, noteId);
    expect(text).toBeDefined();
    a.doc.transact(() => text?.insert(0, 'call the customer'));

    await b.expectMessage();
    expect(b.kinds(seen)).toEqual(['update']);
    expect(textOf(b.snapshot(), noteId)).toBe('call the customer');
    expect(b.snapshot()).toEqual(a.snapshot());
    await a.expectNothing(300);
  });

  it('TC-08 carries a deletion to the other person, with no echo back', async () => {
    const { a, b, noteId } = await pair();
    const seen = b.mark();

    deleteObject(a.doc, noteId);

    await b.expectMessage();
    expect(b.kinds(seen)).toEqual(['update']);
    expect(b.snapshot()).toEqual([]);
    expect(b.snapshot()).toEqual(a.snapshot());
    await a.expectNothing(300);
  });

  it('TC-09 keeps both pieces of simultaneous typing, in the same order for both', async () => {
    const { a, b, noteId } = await pair();
    const textA = getStickyText(a.doc, noteId);
    const textB = getStickyText(b.doc, noteId);
    expect(textA).toBeDefined();
    expect(textB).toBeDefined();

    // Both start from the same word, and both have it.
    a.doc.transact(() => textA?.insert(0, 'green'));
    await eventually(() => expect(textOf(b.snapshot(), noteId)).toBe('green'), {
      what: '"green" reaches B',
    });

    // Now each types without having seen the other: muting the senders is what
    // "concurrent" means here — two edits made against the same state.
    a.mute();
    b.mute();
    textA?.insert(0, 'red ');
    textB?.insert(textB.length, ' blue');
    await a.flush();
    await b.flush();

    await eventually(
      () => {
        expect(textOf(a.snapshot(), noteId)).toBe('red green blue');
        expect(textOf(b.snapshot(), noteId)).toBe('red green blue');
      },
      { what: 'both boards reading "red green blue"' },
    );
  });

  it('TC-10 settles two simultaneous moves of the same note on one position', async () => {
    const { a, b, noteId } = await pair();
    a.mute();
    b.mute();

    moveObject(a.doc, noteId, 100, 300);
    moveObject(b.doc, noteId, 300, 300);
    await a.flush();
    await b.flush();

    await eventually(
      () => {
        const left = a.snapshot()[0];
        const right = b.snapshot()[0];
        expect(left).toBeDefined();
        expect(right).toBeDefined();
        expect(left?.x).toBe(right?.x);
        expect(left?.y).toBe(right?.y);
      },
      { what: 'one agreed position' },
    );
    // It is one of the two positions that were typed, not a blend of them.
    expect([100, 300]).toContain(a.snapshot()[0]?.x);
  });

  it('TC-11 lets a deletion win over simultaneous typing in the deleted note', async () => {
    const { a, b, noteId } = await pair();
    const textB = getStickyText(b.doc, noteId);
    expect(textB).toBeDefined();
    const typed = 'but I was still typing';

    const noise = collectConsoleErrors();
    try {
      // A deletes while B types into the very note being deleted, neither having
      // heard of the other yet.
      a.mute();
      b.mute();
      deleteObject(a.doc, noteId);
      textB?.insert(0, typed);
      await a.flush();
      await b.flush();

      await eventually(
        () => {
          expect(a.snapshot()).toEqual([]);
          expect(b.snapshot()).toEqual([]);
        },
        { what: 'the note gone from both boards' },
      );

      // The lost typing does not survive anywhere, and the note does not come back.
      expect(JSON.stringify(b.snapshot())).not.toContain(typed);
      expect(b.snapshot()).toEqual(a.snapshot());
      expect(noise.errors).toEqual([]);
    } finally {
      noise.restore();
    }
  });

  it(
    'TC-12 converges ' + MAX_CONCURRENT_EDITORS + ' people making 200 random changes each',
    async () => {
      const boardId = newBoardId();
      const clients: Client[] = [];
      for (let index = 0; index < MAX_CONCURRENT_EDITORS; index++) {
        clients.push(await syncedClient(boardId));
      }

      const seeds = clients.map(newSeed);
      console.log(`TC-12 seeds (replay with runSeededOps): ${seeds.join(', ')}`);
      clients.forEach((client, index) => {
        runSeededOps(client.doc, 200, seeds[index] as number);
      });

      const first = await eventually(
        () => {
          const boards = clients.map((client) => client.snapshot());
          for (let index = 1; index < boards.length; index++) {
            if (!sameBoard(boards[0], boards[index])) {
              throw new Error(
                `board ${index} is still behind: ${describeDifference(boards[0], boards[index])}`,
              );
            }
          }
          return boards[0];
        },
        { ms: 30_000, what: 'every board to match' },
      );

      // A board of creates, moves, recolours and deletes still has notes on it,
      // and all of them are the same notes on every screen — nothing lost, nothing
      // left behind on one screen only.
      expect(first.length).toBeGreaterThan(0);
      expect(clients.every((client) => client.snapshot().length === first.length)).toBe(true);
      clients.forEach((client) => client.close());
    },
  );

  it('TC-14 shows a late joiner the whole board as it stands', async () => {
    const boardId = newBoardId();
    const a = await syncedClient(boardId);
    const b = await syncedClient(boardId);

    for (let index = 0; index < 10; index++) {
      createSticky(a.doc, { x: index * 40, y: 0 });
      createSticky(b.doc, { x: 0, y: index * 40 });
    }
    await eventually(() => expect(a.snapshot()).toHaveLength(20), {
      what: 'both boards hold all 20 notes',
    });
    await eventually(() => expect(b.snapshot()).toEqual(a.snapshot()), {
      what: 'the two boards agree',
    });

    // The person who arrives now sees all 20, with the text, colour and position
    // each has at that moment.
    const late = await syncedClient(boardId);
    expect(late.snapshot()).toHaveLength(20);
    expect(late.snapshot()).toEqual(a.snapshot());

    // And it is a live connection, not a photograph.
    const seen = late.mark();
    createSticky(a.doc, { x: 900, y: 900 });
    await late.expectFrame('update');
    expect(late.kinds(seen)).toEqual(['update']);
    await eventually(() => expect(late.snapshot()).toEqual(a.snapshot()), {
      what: 'the late joiner keeps receiving changes',
    });

    late.close();
  });

  describe.each([
    ['a text frame', (client: Client) => client.send('please sync me')],
    [
      'bytes cut short in the middle of a message',
      (client: Client) => client.send(syncStep1Frame(client.doc).subarray(0, 1)),
    ],
    ['an unknown message type', (client: Client) => client.send(new Uint8Array([9, 0, 1, 2]))],
    ['an update that is not a Yjs update', (client: Client) => client.send(brokenUpdateFrame())],
  ])('TC-15 traffic the room cannot read: %s', (_name, sendGarbage) => {
    it('drops that connection only, and leaves the board alone', async () => {
      const boardId = newBoardId();
      const a = await syncedClient(boardId);
      const b = await syncedClient(boardId);

      // Something real to lose, so "the document is unchanged" means something.
      createSticky(a.doc, { x: 10, y: 10 });
      await eventually(() => expect(b.snapshot()).toHaveLength(1), {
        what: 'the note reaches B before the garbage',
      });

      sendGarbage(a);

      // The sender is dropped, for that and nothing else.
      await a.expectClose(CLOSE_UNSUPPORTED_DATA);
      await b.expectOpen(500);
      await b.expectNothing(200);

      // The board is untouched: a newcomer sees exactly what B sees.
      const late = await syncedClient(boardId);
      expect(late.snapshot()).toEqual(b.snapshot());
      expect(late.snapshot()).toHaveLength(1);

      // And the room still relays for everybody else.
      createSticky(b.doc, { x: 20, y: 20 });
      await late.expectFrame('update');
      await eventually(() => expect(late.snapshot()).toEqual(b.snapshot()), {
        what: 'the board carries on',
      });
      late.close();
    });
  });

  it('TC-16 relays awareness to everyone, the sender included, byte for byte', async () => {
    const { a, b } = await pair();
    const seenA = a.mark();
    const seenB = b.mark();

    a.awareness.setLocalStateField('user', 'Alex');
    const frame = awarenessFrame(a.awareness, [a.awareness.clientID]);
    a.send(frame);

    const echoed = await a.expectMessage();
    const delivered = await b.expectMessage();
    expect(Array.from(delivered)).toEqual(Array.from(frame));
    expect(Array.from(echoed)).toEqual(Array.from(delivered));
    expect(a.kinds(seenA)).toEqual(['awareness']);
    expect(b.kinds(seenB)).toEqual(['awareness']);
  });

  it('TC-18 repopulates a room that has lost its memory, from whoever reconnects first', async () => {
    const boardId = newBoardId();
    const a = await syncedClient(boardId);
    const b = await syncedClient(boardId);

    const noteId = createSticky(a.doc, { x: 2, y: 2 }) as string;
    a.doc.transact(() => getStickyText(a.doc, noteId)?.insert(0, 'carry me over'));
    await eventually(() => expect(b.snapshot()).toEqual(a.snapshot()), {
      what: 'both are up to date',
    });

    // Every connection drops, and the object behind them goes with them: that is
    // simulated by moving to a board id nobody has used, a fresh instance whose
    // document has never been created.
    a.close();
    b.close();
    const restarted = newBoardId();

    // A reconnects first, so A's document is what refills the room. B, whose copy
    // is behind by everything A has just done, reconnects after.
    const aAgain = await syncedClient(restarted, a.doc);
    const bAgain = await syncedClient(restarted, b.doc);

    await eventually(() => expect(bAgain.snapshot()).toEqual(aAgain.snapshot()), {
      what: 'B converges with the room A rebuilt',
    });
    expect(bAgain.snapshot()).toHaveLength(1);
    expect(textOf(bAgain.snapshot(), noteId)).toBe('carry me over');

    // The room itself now holds the board: a third person sees it without A
    // saying another word.
    const late = await syncedClient(restarted);
    expect(late.snapshot()).toEqual(aAgain.snapshot());

    aAgain.close();
    bAgain.close();
    late.close();
  });

  it('TC-31 survives sending to a socket that has already gone away', async () => {
    const boardId = newBoardId();
    const a = await syncedClient(boardId);
    const b = await syncedClient(boardId);

    createSticky(a.doc, { x: 5, y: 5 });
    await eventually(() => expect(b.snapshot()).toHaveLength(1), {
      what: 'both boards have the note',
    });

    // B's connection dies while the room still has it in the set it broadcasts to,
    // and a change arrives in the same moment.
    const noise = collectConsoleErrors();
    try {
      b.ws.close();
      createSticky(a.doc, { x: 6, y: 6 });
      await a.expectNothing(300);

      // Nothing threw, and the change went out to everyone who was still there:
      // a connection made afterwards sees both notes.
      const late = await syncedClient(boardId);
      await eventually(() => expect(late.snapshot()).toHaveLength(2), {
        what: 'a later connection still receives updates',
      });
      expect(late.snapshot()).toEqual(a.snapshot());
      expect(noise.errors).toEqual([]);

      // And the room keeps working after the dead socket has been noticed.
      a.mark();
      createSticky(late.doc, { x: 7, y: 7 });
      await a.expectFrame('update');
      await eventually(() => expect(a.snapshot()).toHaveLength(3), {
        what: 'three notes on both boards',
      });
      late.close();
    } finally {
      noise.restore();
    }
  });
});
