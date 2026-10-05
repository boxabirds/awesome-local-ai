/**
 * How long an edit takes to appear on somebody else's screen (task 6.9, TC-22).
 *
 *   TC-22  every kind of update is seen by everybody on the board within
 *          `LIVE_UPDATE_LATENCY_BUDGET_MS`, a busy board stays inside the budget, and
 *          a client that never reads its socket does not push anybody else over it
 *
 * Every number is measured, in milliseconds, and printed: the budget is an
 * expectation the test fails on, not a comment.
 */

import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import {
  OBJECTS_MAP,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { RoomSocket, WsClient } from './helpers/ws-client';

/** Poll granularity for the measurement: 1 ms, far below the budget. */
const SAMPLE_INTERVAL_MS = 1;

/** Times how long `ready` takes to hold for every receiver after `action` runs. */
async function measure(
  label: string,
  action: () => void,
  ready: (client: WsClient) => boolean,
  receivers: readonly WsClient[],
): Promise<number> {
  const started = performance.now();
  action();
  await vi.waitFor(
    () => {
      for (const client of receivers) expect(client.online, 'a receiver went away').toBe(true);
      for (const client of receivers) expect(ready(client), 'not yet applied').toBe(true);
    },
    { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS, interval: SAMPLE_INTERVAL_MS },
  );
  const elapsed = performance.now() - started;
  console.log(`latency ${label}: ${elapsed.toFixed(1)}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);
  return elapsed;
}

function noteCount(client: WsClient): number {
  return client.snapshot().length;
}

describe('an update reaches everybody within the budget (TC-22)', () => {
  it.each([
    'create',
    'move',
    'type',
    'recolour',
    'delete',
  ] as const)('%s on a two-person board', async (kind) => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();

    // The note everyone then watches has to exist before the measurement starts.
    let seed = '';
    alex.transact((doc) => {
      seed = createSticky(doc, { x: 0, y: 0 }, 'yellow') as string;
    });
    await vi.waitFor(() => expect(noteCount(sam)).toBe(1), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS });

    if (kind === 'create') {
      await measure(
        'create',
        () => alex.transact((doc) => createSticky(doc, { x: 500, y: 500 }, 'pink')),
        (client) => noteCount(client) === 2,
        [sam],
      );
    } else if (kind === 'move') {
      await measure(
        'move',
        () => alex.transact((doc) => moveObject(doc, seed, 999, 111)),
        (client) => client.snapshot()[0]?.x === 999,
        [sam],
      );
    } else if (kind === 'type') {
      await measure(
        'typing',
        () => alex.transact((doc) => getStickyText(doc, seed)?.insert(0, 'typed ')),
        (client) => (client.snapshot()[0]?.text ?? '').startsWith('typed '),
        [sam],
      );
    } else if (kind === 'recolour') {
      await measure(
        'recolour',
        () => alex.transact((doc) => setStickyColor(doc, seed, 'green')),
        (client) => client.snapshot()[0]?.color === 'green',
        [sam],
      );
    } else {
      await measure(
        'delete',
        () => alex.transact((doc) => deleteObject(doc, seed)),
        (client) => noteCount(client) === 0,
        [sam],
      );
    }
    expect(sam.snapshot()).toEqual(alex.snapshot());
  });

  it(`${MAX_CONCURRENT_EDITORS + 1} clients × 10 updates each all land within the budget`, async () => {
    const boardId = newBoardId();
    const people = MAX_CONCURRENT_EDITORS + 1;
    const clients: WsClient[] = [];
    for (let index = 0; index < people; index++) clients.push(await WsClient.connect(boardId));
    for (const client of clients) await client.waitForSync();

    // When a note first becomes visible on a client that did not create it, that is
    // that client's arrival time for that update.
    const arrivedAt = new Map<string, number>();
    const key = (noteId: string, client: WsClient) => `${noteId}@${clients.indexOf(client)}`;
    clients.forEach((client, index) => {
      const objects = client.doc.getMap(OBJECTS_MAP) as Y.Map<Y.Map<unknown>>;
      objects.observe((event) => {
        for (const [noteId, change] of event.changes.keys) {
          if (change.action === 'add' && !arrivedAt.has(key(noteId, client))) {
            arrivedAt.set(key(noteId, client), performance.now());
          }
        }
      });
      expect(index).toBeLessThan(people);
    });

    const sentAt = new Map<string, number>();
    const owner = new Map<string, WsClient>();
    for (let round = 0; round < 10; round++) {
      for (const client of clients) {
        client.transact((doc) => {
          const noteId = createSticky(doc, { x: round * 10, y: 0 }, 'yellow');
          if (noteId !== false) {
            // Recorded in the same tick as the transaction, so nobody else can have
            // received the update before its send time is noted.
            sentAt.set(noteId, performance.now());
            owner.set(noteId, client);
          }
        });
      }
    }
    expect(sentAt.size).toBe(people * 10);

    await vi.waitFor(
      () => {
        for (const client of clients) expect(client.snapshot()).toHaveLength(sentAt.size);
      },
      { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS, interval: SAMPLE_INTERVAL_MS },
    );

    let worst = 0;
    let worstLabel = '';
    for (const [noteId, sent] of sentAt) {
      for (const [index, client] of clients.entries()) {
        if (owner.get(noteId) === client) continue;
        const arrival = arrivedAt.get(`${noteId}@${index}`);
        expect(arrival, `client ${index} never received note ${noteId}`).toBeTypeOf('number');
        const latency = (arrival as number) - sent;
        if (latency > worst) {
          worst = latency;
          worstLabel = `note ${noteId.slice(0, 8)} to client ${index}`;
        }
      }
    }
    console.log(
      `latency ${sentAt.size} updates across ${people} clients: worst ${worst.toFixed(1)}ms (${worstLabel}), budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms`,
    );
    expect(worst).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);
  });

  it('a client that never reads its socket does not slow the others down', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    // A connection that is opened and then never read from: whatever the room sends it
    // sits in its buffer. This is the slowest client the room can have.
    const neverReads = await RoomSocket.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    expect(neverReads.isOpen).toBe(true);

    let seed = '';
    alex.transact((doc) => {
      seed = createSticky(doc, { x: 0, y: 0 }, 'yellow') as string;
    });
    await vi.waitFor(() => expect(noteCount(sam)).toBe(1), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS });

    for (let index = 0; index < 5; index++) {
      await measure(
        `move with a stalled client present (${index + 1})`,
        () => alex.transact((doc) => moveObject(doc, seed, index * 100, 0)),
        (client) => client.snapshot()[0]?.x === index * 100,
        [sam],
      );
    }
    expect(neverReads.isOpen).toBe(true);
    expect(sam.snapshot()).toEqual(alex.snapshot());
  });

  it('a large board is still within the budget', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();

    // Fill the board with 200 notes, then measure one more update on top of it.
    alex.transact((doc) => {
      for (let index = 0; index < 200; index++) createSticky(doc, { x: index * 7, y: index * 3 }, 'yellow');
    });
    await vi.waitFor(() => expect(noteCount(sam)).toBe(200), { timeout: 10_000 });
    const last = sam.snapshot()[199] as { id: string };

    await measure(
      'move on a 200 note board',
      () => alex.transact((doc) => moveObject(doc, last.id, 4242, 4242)),
      (client) => client.snapshot().some((note) => note.x === 4242 && note.y === 4242),
      [sam],
    );
  });
});
