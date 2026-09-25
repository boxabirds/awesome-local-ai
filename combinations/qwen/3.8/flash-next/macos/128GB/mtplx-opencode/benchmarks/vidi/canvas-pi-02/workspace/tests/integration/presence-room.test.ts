/**
 * Presence in the room (story 6, task 5: TC-04 to TC-08).
 *
 * These are the tests that can say something true about *leaving*. The unit
 * suite in `tests/unit/awareness-tracker.test.ts` proves the encode/decode half;
 * what only a room can prove is the part that happens to a socket: a person
 * closes their tab, and every other screen has to stop drawing them. That needs
 * real WebSockets with real attachments, a real `Awareness` on the receiving
 * side to apply the removal, and a room that reads the answer from where it is
 * actually kept — the socket, not a field that a hibernation would wipe.
 *
 * Three things these tests check that a frame log cannot:
 *
 *  - that a removal frame is *applied*, not merely delivered (`holdsPresence`);
 *  - that a socket is charged only for the presence it announces about itself,
 *    so leaving does not take other people's avatars with it;
 *  - that bytes the room cannot read are still carried, and cost nobody their
 *    connection.
 *
 * @see spec/stories/06-see-who-else-is-on-the-board-and-where-their-curso/design.md
 */
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import {
  PRESENCE_CLOSE_REMOVAL_BUDGET_MS,
  PRESENCE_EXISTING_VISIBLE_BUDGET_MS,
} from '../../src/shared/config';
import { decodeMessage } from '../../src/shared/protocol';
import { TestPeer, roomPresence, roomSocketCount, settle, waitFor } from './helpers/ws-client';

/**
 * A person, as one would be announced by a real client.
 *
 * The shape is the design's (`user`/`cursor`/`selection`) rather than a convenient
 * one, because the whole point of these tests is that the room's book matches what
 * the browser side actually puts on the wire.
 */
const SOMEONE = {
  user: { id: 'g_braveheron', name: 'Brave Heron', color: '#1E88E5' },
  cursor: { x: 120.5, y: -40 },
  selection: [],
};

/** Two editors on one fresh board, with the board id they are both on. */
async function pair(name: string): Promise<[string, TestPeer, TestPeer]> {
  const board = newBoardId();
  const a = await TestPeer.connect(board, { name: `${name}-A` });
  const b = await TestPeer.connect(board, { name: `${name}-B` });
  await settle([a, b]);
  return [board, a, b];
}

/** How many frames this client has been sent so far. */
const frameCount = (peer: TestPeer): number => peer.frames.length;

/** How many sockets the room is still holding for `board`. */
async function heldSockets(board: string): Promise<number> {
  return roomSocketCount(board);
}

/** Wait until the room has stopped holding all but `count` sockets. */
async function waitSockets(board: string, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await roomSocketCount(board)) === count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the room kept holding ${await roomSocketCount(board)} sockets, wanted ${count}`);
}

describe('a person who closes the tab stops being drawn (TC-04)', () => {
  it('takes their presence off the other editor within the removal budget', async () => {
    const [, a, b] = await pair('close');
    a.publishPresence(SOMEONE);
    b.publishPresence({ ...SOMEONE, user: { ...SOMEONE.user, id: 'g_curiotter', name: 'Curious Otter' } });
    await settle([a, b]);

    // Both halves have to be true before the close means anything: B is a person
    // on A's screen, and A knows it.
    expect(a.holdsPresence(b.awareness.clientID), 'A to be holding B').toBe(true);
    const ownBefore = a.awareness.getLocalState();

    const started = Date.now();
    b.close();

    // The budget is the assertion, and it is measured: the design asks for removal
    // within `PRESENCE_CLOSE_REMOVAL_BUDGET_MS`, so a room that took thirty seconds
    // would fail here rather than pass slowly.
    await waitFor(
      () => !a.holdsPresence(b.awareness.clientID),
      `A to drop B within ${PRESENCE_CLOSE_REMOVAL_BUDGET_MS} ms`,
      PRESENCE_CLOSE_REMOVAL_BUDGET_MS,
    );
    const elapsed = Date.now() - started;

    expect(a.frames.some((frame) => frame.kind === 'awareness'), 'a presence frame for A').toBe(
      true,
    );
    expect(elapsed, 'removal time').toBeLessThanOrEqual(PRESENCE_CLOSE_REMOVAL_BUDGET_MS);
    // A's own presence is untouched: a removal that cleared the whole map would
    // take A off their own screen, which nobody has ever asked for.
    expect(a.awareness.getLocalState()).toEqual(ownBefore);
    expect(a.closed, 'A is still connected').toBe(false);
  });

  it('leaves the other editor able to keep working', async () => {
    const [board, a, b] = await pair('close-live');
    a.publishPresence(SOMEONE);
    b.publishPresence(SOMEONE);
    await settle([a, b]);

    b.close();
    await waitSockets(board, 1);
    expect(a.closed, 'A is still connected').toBe(false);
  });
});

describe('the book of who is here lives on the socket (TC-05)', () => {
  it('keeps one record per socket, naming only that socket\'s own people', async () => {
    const [board, a, b] = await pair('attachment');
    a.publishPresence(SOMEONE);
    b.publishPresence({ ...SOMEONE, user: { ...SOMEONE.user, id: 'g_third', name: 'Third Person' } });
    await settle([a, b]);

    const books = await roomPresence(board);
    expect(books.length, 'one record per socket').toBe(2);
    // Each socket carries its own client and nobody else's — and it carries it as
    // an *attachment*, which is the only place that survives hibernation. Read
    // back through the same `deserializeAttachment` call the departure handler
    // makes, so the test asks the question the code answers.
    const everyId = books.flatMap((book) => Object.keys(book));
    expect(new Set(everyId).size, 'no id shared between two sockets').toBe(everyId.length);
    expect(everyId).toContain(String(a.awareness.clientID));
    expect(everyId).toContain(String(b.awareness.clientID));
  });

  it('does not charge a socket for presence it only carried', async () => {
    const [board, a, b] = await pair('carried');
    a.publishPresence(SOMEONE);
    b.publishPresence({ ...SOMEONE, user: { ...SOMEONE.user, id: 'g_carry', name: 'Carrier' } });
    await settle([a, b]);

    // The newcomer, and the answer it gets: B replies to the room's question by
    // forwarding *every* state it holds, which is what `y-websocket` does. So the
    // frame that introduces A to C travels through B's socket.
    const c = await TestPeer.connect(board, { name: 'C' });
    await settle([a, b, c]);
    b.relayPresence();
    await settle([a, b, c]);

    await waitFor(() => c.holdsPresence(a.awareness.clientID), 'C to have learned about A');
    const books = await roomPresence(board);
    expect(
      Object.keys(books[1] ?? {}).length,
      `B's record: ${JSON.stringify(books[1])}`,
    ).toBeLessThanOrEqual(1);

    // The consequence that matters: B going must take B off C's screen and leave
    // A on it. A room that filed carried presence against the carrier would wipe
    // an idle person every time the person who happened to relay them left.
    b.close();
    await waitFor(() => !c.holdsPresence(b.awareness.clientID), 'C to drop B');
    expect(c.holdsPresence(a.awareness.clientID), 'C still holds A').toBe(true);
    expect(c.closed).toBe(false);
  });
});

describe('a newcomer meets the people already on the board (TC-06)', () => {
  it('asks the people already here who they are, and tells the newcomer', async () => {
    const [board, a, b] = await pair('query');
    a.publishPresence(SOMEONE);
    b.publishPresence({ ...SOMEONE, user: { ...SOMEONE.user, id: 'g_othertab', name: 'Other Person' } });
    await settle([a, b]);

    const started = Date.now();
    const c = await TestPeer.connect(board, { name: 'C' });
    await settle([a, b, c]);

    // Both halves of the requirement: the question went out...
    expect(a.frames.some((frame) => frame.kind === 'query-awareness'), 'A was asked').toBe(true);
    expect(b.frames.some((frame) => frame.kind === 'query-awareness'), 'B was asked').toBe(true);

    // ...and the answers came back, so a newcomer that has not moved its mouse
    // still sees the two idle people within the budget the PRD gives.
    await waitFor(
      () => c.holdsPresence(a.awareness.clientID) && c.holdsPresence(b.awareness.clientID),
      `C to hold A and B within ${PRESENCE_EXISTING_VISIBLE_BUDGET_MS} ms`,
      PRESENCE_EXISTING_VISIBLE_BUDGET_MS,
    );
    expect(Date.now() - started).toBeLessThanOrEqual(PRESENCE_EXISTING_VISIBLE_BUDGET_MS);
    // The newcomer is not asked about a room it has just arrived in.
    expect(c.frames.some((frame) => frame.kind === 'query-awareness'), 'C was not asked').toBe(
      false,
    );
  });

  it('survives a query that goes to a socket which closed mid-answer', async () => {
    const [board, a, b] = await pair('query-race');
    a.publishPresence(SOMEONE);
    b.publishPresence(SOMEONE);
    await settle([a, b]);

    // The race the design names: one socket goes while the room is still busy
    // handing a newcomer the people already here.
    b.close();
    await waitSockets(board, 1);
    const c = await TestPeer.connect(board, { name: 'C' });
    await settle([a, c]);

    await waitFor(
      () => c.holdsPresence(a.awareness.clientID),
      'C to learn about A after B went',
      PRESENCE_EXISTING_VISIBLE_BUDGET_MS,
    );
    expect(c.closed, 'the newcomer is still connected').toBe(false);
    expect(a.closed, 'the editor it joined is still connected').toBe(false);
  });
});

describe('presence bytes the room cannot read (TC-07)', () => {
  it('relays them, charges nobody, and keeps the connection', async () => {
    const [board, a, b] = await pair('garbage');
    a.publishPresence(SOMEONE);
    await settle([a, b]);
    const before = await roomPresence(board);
    const framesBefore = frameCount(b);
    // Framed as awareness, but the body claims more entries than it carries and
    // ends in bytes that are not a length-prefixed state: undecodable, in every
    // sense the tracker checks.
    const junk = new Uint8Array([1, 6, 2, 200, 200, 200, 7, 9]);
    a.send(junk);
    await waitFor(
      () => b.frames.length > framesBefore,
      'B to be given the bytes',
      PRESENCE_CLOSE_REMOVAL_BUDGET_MS,
    );

    const got = b.frames.slice(framesBefore).find((frame) => frame.kind === 'awareness');
    expect(got, 'the junk was not dropped').toBeDefined();
    expect(Uint8Array.from(got!.bytes)).toEqual(junk);
    expect(decodeMessage(got!.bytes).kind, 'and it is still recognised as presence').toBe(
      'awareness',
    );

    // Unreadable bytes are not a reason to change who the room thinks is here:
    // nothing new is filed against any socket. (The room's book is not empty before
    // the junk - a client answers the join query with its own state, as the real
    // provider does - so the assertion is about *new* entries, which is what the
    // junk could have added.)
    const after = await roomPresence(board);
    const idsBefore = new Set(before.flatMap((book) => Object.keys(book)));
    const idsAfter = new Set(after.flatMap((book) => Object.keys(book)));
    expect([...idsAfter].filter((id) => !idsBefore.has(id)), 'no new client was filed').toEqual(
      [],
    );
    expect(after.length, 'the book is still per socket').toBe(before.length);

    // And not a reason to drop anybody either: the board keeps working in both
    // directions afterwards.
    expect(a.closed).toBe(false);
    expect(b.closed).toBe(false);
    expect(await heldSockets(board), 'both sockets are still held').toBe(2);
  });
});

describe('a socket that never said who it was (TC-08)', () => {
  it('broadcasts no removal and stays out of the book', async () => {
    const [board, a, b] = await pair('silent');
    await settle([a, b]);
    // B has said nothing about itself, so nothing is filed against it: whatever
    // the first editor's socket carries is its own state, answered once at the join
    // query.
    expect(await roomPresence(board), 'B has announced nobody').toEqual([expect.any(Object), {}]);

    const framesBefore = frameCount(a);
    b.close();
    await waitSockets(board, 1);
    await settle([a]);

    // Nothing to remove means nothing to say: a room that broadcast a removal for
    // a client it never saw would be inventing a person on every other screen in
    // order to delete them.
    const added = a.frames.slice(framesBefore);
    expect(
      added.some((frame) => frame.kind === 'awareness'),
      `no presence traffic after B went: ${added.map((frame) => frame.kind).join(',') || 'nothing'}`,
    ).toBe(false);
    expect(a.closed, 'A was not disturbed').toBe(false);
  });
});
