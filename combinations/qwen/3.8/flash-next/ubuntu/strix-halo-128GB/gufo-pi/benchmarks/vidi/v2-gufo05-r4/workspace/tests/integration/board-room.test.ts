/**
 * Integration: the room merges, broadcasts, and survives bad traffic
 * (TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31).
 *
 * Everything here is real: real Durable Object, real WebSockets, real Yjs, and the
 * real `src/shared/board-model.ts` mutators making the changes. What a test asserts
 * is either what the other person's document now holds, or what actually crossed the
 * wire — the two are different claims and the story depends on both: content has to
 * converge, and it must not do it by shouting at everybody on every keystroke.
 */

import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor
} from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS } from '../../src/shared/protocol';
import { applyRandomOps } from './helpers/random-ops';
import { randomSeed } from '../helpers/random';
import { join, joinAll, leaveAll, TestClient, waitForConvergence } from './helpers/ws-client';

/** Clients opened by a test, closed whatever the test did with them. */
let opened: TestClient[] = [];

afterEach(async () => {
  const clients = opened;
  opened = [];
  await leaveAll(clients);
});

/** Two people on a board of their own. */
async function pair(): Promise<[TestClient, TestClient]> {
  const [a, b] = await joinAll(newBoardId(), 2);
  opened.push(a, b);
  return [a, b];
}

/** A note both of them can see. */
async function noteFor(a: TestClient, b: TestClient): Promise<string> {
  const id = createSticky(a.doc, { x: 10, y: 20 });
  await TestClient.waitUntil(() => b.snapshot().some((note) => note.id === id));
  return id;
}

describe('one change, one copy', () => {
  // TC-07
  it('carries a new note to the other person exactly once', async () => {
    const [a, b] = await pair();
    const id = createSticky(a.doc, { x: 10, y: 20 });
    await TestClient.waitUntil(() => b.snapshot().some((note) => note.id === id));

    expect(b.snapshot()).toEqual(a.snapshot());
    // One change is one update — the room does not re-send the world each time.
    expect(b.updateCount).toBe(1);
  });

  // TC-08
  const changes: [string, (doc: Y.Doc, id: string) => void][] = [
    ['a move', (doc, id) => moveObject(doc, id, 250, -75)],
    ['a recolour', (doc, id) => setStickyColor(doc, id, 'blue')],
    [
      'typing',
      (doc, id) => {
        const text = getStickyText(doc, id);
        if (text) doc.transact(() => text.insert(0, 'quarterly '));
      }
    ],
    ['a delete', (doc, id) => deleteObject(doc, id)]
  ];

  for (const [name, operate] of changes) {
    it(`carries ${name} across and echoes nothing back`, async () => {
      const [a, b] = await pair();
      const id = await noteFor(a, b);
      const aHadBefore = a.updateCount;
      const bHadBefore = b.updateCount;

      operate(a.doc, id);

      await waitForConvergence([a, b]);
      expect(b.updateCount).toBeGreaterThan(bHadBefore);
      // Nothing comes back to the person who made the change.
      expect(a.updateCount).toBe(aHadBefore);
    });
  }
});

describe('two people, same moment', () => {
  // TC-09
  it('keeps both sets of words when they type at the same time', async () => {
    const [a, b] = await pair();
    const id = await noteFor(a, b);
    const textA = getStickyText(a.doc, id);
    const textB = getStickyText(b.doc, id);
    if (!textA || !textB) throw new Error('the note has no shared text to type into');

    textA.insert(0, 'green');
    await TestClient.waitUntil(() => b.snapshot().some((note) => note.text === 'green'));

    // Both edit before either has heard about the other.
    textA.insert(0, 'red ');
    textB.insert(textB.length, ' blue');

    await waitForConvergence([a, b]);
    const text = a.snapshot().find((note) => note.id === id)?.text;
    expect(text).toBe('red green blue');
    expect(b.snapshot().find((note) => note.id === id)?.text).toBe(text);
  });

  // TC-10
  it('settles a fight over where a note goes on a single answer', async () => {
    const [a, b] = await pair();
    const id = await noteFor(a, b);

    moveObject(a.doc, id, 100, 100);
    moveObject(b.doc, id, 300, 300);

    await waitForConvergence([a, b]);
    const onA = a.snapshot().find((note) => note.id === id);
    const onB = b.snapshot().find((note) => note.id === id);
    expect(onA?.x).toBe(onB?.x);
    // It is one of the two positions somebody chose, not a mixture of them.
    expect([100, 300]).toContain(onA?.x);
  });

  // TC-11 (error path: a note deleted under somebody's caret)
  it('lets a delete win a concurrent edit without dragging anybody down', async () => {
    const [a, b] = await pair();
    const id = await noteFor(a, b);
    const textB = getStickyText(b.doc, id);
    if (!textB) throw new Error('the note has no shared text to type into');

    deleteObject(a.doc, id);
    textB.insert(0, 'still typing away');

    await waitForConvergence([a, b]);
    expect(a.snapshot()).toEqual([]);
    expect(b.snapshot()).toEqual([]);
    // The words are not hiding somewhere on the board.
    expect(b.snapshot().some((note) => note.text.includes('still typing'))).toBe(false);

    // And the room is still a room: later changes still travel.
    const later = createSticky(a.doc, { x: 1, y: 1 });
    await TestClient.waitUntil(() => b.snapshot().some((note) => note.id === later));
    expect(a.closed).toBe(false);
    expect(b.closed).toBe(false);
  });

  // TC-12 (boundary: full capacity, a lot of traffic)
  it(
    `converges ${MAX_CONCURRENT_EDITORS} editors over 200 random changes each`,
    async () => {
      const seed = randomSeed();
      const clients = await joinAll(newBoardId(), MAX_CONCURRENT_EDITORS);
      opened = clients;
      const run = applyRandomOps(clients, seed, 200 * clients.length);

      await waitForConvergence(clients, 30_000);

      const summaries = clients.map((client) => client.snapshot());
      const expected = JSON.stringify(summaries[0]);
      for (const [index, summary] of summaries.entries()) {
        expect(
          JSON.stringify(summary),
          `client ${index} differs; seed ${seed}, ${run.log.length} operations`
        ).toBe(expected);
      }
      // The run really did produce a board worth comparing.
      expect(summaries[0].length).toBeGreaterThan(0);
    },
    90_000
  );
});

describe('coming and going', () => {
  // TC-14
  it('gives a late joiner the whole board', async () => {
    const boardId = newBoardId();
    const [a, b] = await joinAll(boardId, 2);
    opened.push(a, b);
    for (let index = 0; index < 20; index += 1) {
      createSticky(index % 2 === 0 ? a.doc : b.doc, { x: index * 30, y: index * 20 });
    }
    await waitForConvergence([a, b]);

    const late = await join(boardId);
    opened.push(late);
    expect(late.snapshot()).toHaveLength(20);
    expect(late.snapshot()).toEqual(a.snapshot());
  });

  // TC-18
  it('is rebuilt from the first person back when it starts out empty', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    opened.push(a);
    createSticky(a.doc, { x: 1, y: 2 });
    createSticky(a.doc, { x: 3, y: 4 });
    await a.close();

    // An empty in-memory doc with nobody in it is exactly what a restarted room
    // looks like — nothing is persisted in this story — and a brand new board id is
    // the only way to be sure of getting one.
    const restarted = newBoardId();
    const aBack = await join(restarted, { doc: a.doc });
    const bBack = await join(restarted);
    opened.push(aBack, bBack);

    expect(aBack.snapshot()).toHaveLength(2);
    expect(bBack.snapshot()).toEqual(aBack.snapshot());
  });

  // TC-31 (error path: a peer disappears mid-broadcast)
  it('carries on when a peer vanishes halfway through a broadcast', async () => {
    const boardId = newBoardId();
    const [a, vanishing] = await joinAll(boardId, 2);
    const staying = await join(boardId);
    opened.push(a, vanishing, staying);

    // The room still holds this socket, and does not know it is dead yet.
    vanishing.closeNow();
    for (let index = 0; index < 5; index += 1) createSticky(a.doc, { x: index, y: index });

    const noteId = createSticky(a.doc, { x: 99, y: 99 });
    await TestClient.waitUntil(() => staying.snapshot().some((note) => note.id === noteId));
    expect(a.closed).toBe(false);
    expect(staying.closed).toBe(false);
    expect(await vanishing.waitForClose()).toBeTruthy();
  });
});

describe('bad traffic', () => {
  // TC-15: four kinds of nonsense, each its own run.
  const nonsense: [string, (client: TestClient) => void][] = [
    ['a text frame', (client) => client.send('hello there')],
    [
      'truncated bytes',
      (client) => {
        // An awareness frame that announces ten payload bytes and then stops.
        client.send(new Uint8Array([MESSAGE_AWARENESS, 10, 1, 2, 3]));
      }
    ],
    ['an unknown message type', (client) => client.send(new Uint8Array([9, 1, 2, 3]))],
    ['an update that is not an update', (client) => client.sendSyncPayload(new Uint8Array([2, 9, 250, 1, 7, 7, 7]))]
  ];

  for (const [name, sendNonsense] of nonsense) {
    it(`closes only whoever sent ${name}, and the board is untouched`, async () => {
      const boardId = newBoardId();
      const [a, b] = await joinAll(boardId, 2);
      opened.push(a, b);
      const id = await noteFor(a, b);
      const notesBefore = b.snapshot().length;

      sendNonsense(a);

      const closed = await a.waitForClose();
      expect(closed.code).toBe(CLOSE_UNSUPPORTED_DATA);

      // The other person never noticed: still open, still collaborating.
      expect(b.closed).toBe(false);
      const later = createSticky(b.doc, { x: 60, y: 60 });
      const witness = await join(boardId);
      opened.push(witness);
      expect(witness.snapshot().some((note) => note.id === later)).toBe(true);
      // And nothing the nonsense could have written is on the board.
      expect(witness.snapshot().length).toBe(notesBefore + 1);
      expect(witness.snapshot().some((note) => note.id === id)).toBe(true);
    });
  }
});

describe('awareness', () => {
  // TC-16
  it('relays awareness bytes to everybody, sender included', async () => {
    const [a, b] = await pair();

    a.sendAwareness({ x: 120, y: 240 });

    await TestClient.waitUntil(() => a.awarenessFrames.length >= 1 && b.awarenessFrames.length >= 1);
    // Byte for byte identical, and nobody interpreted them here.
    expect(Array.from(a.awarenessFrames[0])).toEqual(Array.from(b.awarenessFrames[0]));
    expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({ cursor: { x: 120, y: 240 } });
  });
});
