/**
 * sync.room_merge + the socket half of the room's behaviour, against a real
 * `wrangler dev` server (see `helpers/live-server.ts`) with real WebSockets.
 * Each test uses its own random board id, so no test can see another's room.
 *
 * TC-07 late joiner + single update · TC-08 move/recolour/text/delete ·
 * TC-09 concurrent text · TC-10 concurrent writes to one field ·
 * TC-11 delete during edit · TC-12 five clients × 200 random ops ·
 * TC-13 a 6th participant · TC-14 late joiner after 40 notes ·
 * TC-15 malformed traffic closes only the offending socket ·
 * TC-16 awareness relayed identically · TC-17 boards are isolated ·
 * TC-18 a room that lost its doc is repopulated by the first client ·
 * TC-31 a dead socket does not break the room.
 */

import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createSticky,
  deleteObject,
  getStickyText,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '../../src/shared/protocol';
import { applyRandomOp, seededRandom } from '../fixtures/random-ops';
import {
  allConverged,
  RoomClient,
  snapshotsEqual,
  until,
  type RoomClientOptions,
} from './helpers/ws-client';

const open: RoomClient[] = [];

async function join(boardId: string, options: RoomClientOptions = {}): Promise<RoomClient> {
  const client = await RoomClient.connectSynced(boardId, options);
  open.push(client);
  return client;
}

function typeText(client: RoomClient, id: string, at: number, text: string): void {
  const yText = getStickyText(client.doc, id);
  if (!yText) throw new Error(`note ${id} has no text`);
  client.doc.transact(() => yText.insert(at, text), LOCAL_ORIGIN);
}

async function expectCloseCode(client: RoomClient, code: number): Promise<void> {
  const tooSlow = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error(`socket was not closed with ${code}`)), E2E_EVENTUAL_TIMEOUT_MS);
  });
  const closed = await Promise.race([client.closed, tooSlow]);
  expect(closed.code).toBe(code);
}

/** A well-framed sync *update* message whose payload is not a Yjs update. */
function badUpdateFrame(bytes: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, bytes);
  return encoding.toUint8Array(encoder);
}

afterEach(() => {
  for (const client of open.splice(0)) client.dispose();
});

describe('board room', () => {
  it('TC-07: a newcomer gets the board, and the next change arrives as exactly one update', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const existing = createSticky(a.doc, { x: 0, y: 0 }, 'blue');

    const b = await join(boardId);
    expect(b.boardSnapshot().map((n) => n.id)).toEqual([existing]);
    expect(b.updateFrames()).toEqual([]);

    const sentAt = Date.now();
    const id = createSticky(a.doc, { x: 300, y: -120 }, 'pink');
    await until(() => b.boardSnapshot().some((n) => n.id === id), 'new note to reach B');
    console.log(
      `TC-07: change reached the other client in ${Date.now() - sentAt} ms ` +
        `(PRD budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`,
    );

    expect(b.updateFrames().length).toBe(1);
    expect(snapshotsEqual(a.boardSnapshot(), b.boardSnapshot())).toBe(true);
  });

  describe.each([
    ['a move', (a: RoomClient, id: string) => moveObject(a.doc, id, 640, -320)],
    ['a recolour', (a: RoomClient, id: string) => setStickyColor(a.doc, id, 'violet')],
    ['a text insertion', (a: RoomClient, id: string) => typeText(a, id, 0, 'typewriter')],
    ['a delete', (a: RoomClient, id: string) => deleteObject(a.doc, id)],
  ])('TC-08: %s', (_label, mutate) => {
    it('reaches the other client once, with no echo back to the sender', async () => {
      const boardId = newBoardId();
      const a = await join(boardId);
      const b = await join(boardId);
      const id = createSticky(a.doc, { x: 10, y: 10 });
      await until(() => b.boardSnapshot().length === 1, 'note to reach B');
      expect(a.updateFrames()).toEqual([]);

      const updatesBefore = b.updateFrames().length;
      mutate(a, id);
      await until(() => snapshotsEqual(a.boardSnapshot(), b.boardSnapshot()), 'change to reach B');

      expect(b.updateFrames().length).toBe(updatesBefore + 1);
      // The sender never sees its own change come back.
      expect(a.updateFrames()).toEqual([]);
    });
  });

  it('TC-09: concurrent insertions at both ends of one note keep all the text', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    typeText(a, id, 0, 'green');
    await until(() => b.boardSnapshot()[0]?.text === 'green', 'note text to reach B');

    // Neither client sees the other's edit before writing.
    a.setAutoSend(false);
    b.setAutoSend(false);
    typeText(a, id, 0, 'red ');
    typeText(b, id, getStickyText(b.doc, id)!.length, ' blue');
    a.flushLocalUpdates();
    b.flushLocalUpdates();

    await until(() => snapshotsEqual(a.boardSnapshot(), b.boardSnapshot()), 'both to converge');
    expect(a.boardSnapshot()[0]?.text).toBe('red green blue');
    expect(b.boardSnapshot()[0]?.text).toBe('red green blue');
  });

  it('TC-10: concurrent writes to one field converge to one identical value', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await until(() => b.boardSnapshot().length === 1, 'note to reach B');

    a.setAutoSend(false);
    b.setAutoSend(false);
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    a.flushLocalUpdates();
    b.flushLocalUpdates();

    await until(() => snapshotsEqual(a.boardSnapshot(), b.boardSnapshot()), 'both to converge');
    const xOnA = a.boardSnapshot()[0]?.x;
    const xOnB = b.boardSnapshot()[0]?.x;
    console.log(`TC-10: concurrent x writes settled on ${xOnA} (100 or 300) on both clients`);
    expect(xOnA).toBe(xOnB);
    expect([100, 300]).toContain(xOnA);
  });

  it('TC-11: a note deleted while someone is typing stays deleted, without an exception', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    typeText(a, id, 0, 'green');
    await until(() => b.boardSnapshot()[0]?.text === 'green', 'note to reach B');

    a.setAutoSend(false);
    b.setAutoSend(false);
    deleteObject(a.doc, id);
    typeText(b, id, 5, '!! still typing');
    a.flushLocalUpdates();
    b.flushLocalUpdates();

    await until(
      () => a.boardSnapshot().length === 0 && b.boardSnapshot().length === 0,
      'the deletion to win on both clients',
    );
    // The typed text cannot resurrect the note, on either client.
    expect(a.boardSnapshot()).toEqual([]);
    expect(b.boardSnapshot()).toEqual([]);
    // Nobody was kicked out for it.
    expect(a.closes).toEqual([]);
    expect(b.closes).toEqual([]);
  });

  it('TC-12: five clients, 200 random operations each, one identical board', async () => {
    const boardId = newBoardId();
    const clients = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS }, () => join(boardId)),
    );
    const baseSeed = 20_260_903;
    const generators = clients.map((_client, index) => seededRandom(baseSeed + index));
    console.log(`TC-12: seeds ${clients.map((_c, index) => baseSeed + index).join(', ')}`);

    const opsPerClient = 200;
    for (let round = 0; round < opsPerClient; round++) {
      for (let index = 0; index < clients.length; index++) {
        applyRandomOp(clients[index]!.doc, generators[index]!);
      }
    }

    await until(() => allConverged(clients), 'all five clients to converge');
    const expected = JSON.stringify(clients[0]!.boardSnapshot());
    for (const [index, client] of clients.entries()) {
      // Prefixed with the index so a failure says *which* client diverged.
      expect(`${index}:${JSON.stringify(client.boardSnapshot())}`).toBe(`${index}:${expected}`);
    }
    expect(clients[0]!.boardSnapshot().length).toBeGreaterThan(0);
    expect(clients.every((client) => client.closes.length === 0)).toBe(true);
  });

  it('TC-13: a 6th participant on a full board joins and edits normally', async () => {
    const boardId = newBoardId();
    const clients = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS + 1 }, () => join(boardId)),
    );

    const last = clients[clients.length - 1]!;
    const id = createSticky(last.doc, { x: 40, y: 50 }, 'pink');
    await until(
      () => clients.slice(0, -1).every((client) => client.boardSnapshot().some((n) => n.id === id)),
      `the 6th client's note to reach the other ${MAX_CONCURRENT_EDITORS}`,
    );
    expect(allConverged(clients)).toBe(true);
  });

  it('TC-14: a client that joins after 40 concurrent notes gets all 40', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    for (let i = 0; i < 20; i++) createSticky(a.doc, { x: i * 30, y: 0 });
    for (let i = 0; i < 20; i++) createSticky(b.doc, { x: -i * 30, y: 100 });
    await until(() => a.boardSnapshot().length === 40 && b.boardSnapshot().length === 40, '40 notes');

    const late = await join(boardId);
    expect(late.boardSnapshot().length).toBe(40);
    expect(snapshotsEqual(late.boardSnapshot(), a.boardSnapshot())).toBe(true);
  });

  describe.each([
    ['a text frame', () => 'this is not a yjs frame'],
    ['a truncated frame header', () => new Uint8Array([MESSAGE_SYNC])],
    ['an unknown frame type', () => new Uint8Array([42, 0])],
    // Yjs logs this one itself (`y-protocols` prints the decode error before the
    // room can act on it), so the run is noisy on purpose.
    ['an undecodable yjs update', () => badUpdateFrame(new Uint8Array([1, 2, 3, 4, 5]))],
  ])('TC-15: %s', (_label, frame) => {
    it('closes only the offending socket, and the room carries on', async () => {
      const boardId = newBoardId();
      const a = await join(boardId);
      const b = await join(boardId);
      const id = createSticky(a.doc, { x: 0, y: 0 });
      await until(() => b.boardSnapshot().length === 1, 'note to reach B');

      a.sendRaw(frame());
      await expectCloseCode(a, CLOSE_UNSUPPORTED_DATA);

      // The room's document is untouched: a newcomer sees exactly what was there.
      const late = await join(boardId);
      expect(late.boardSnapshot().map((n) => n.id)).toEqual([id]);

      // And the room still relays for everybody else.
      const second = createSticky(b.doc, { x: 80, y: 0 });
      await until(() => late.boardSnapshot().some((n) => n.id === second), 'later change to arrive');
      expect(b.closes).toEqual([]);
    });
  });

  it('TC-16: awareness bytes reach every client on the board identically', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);

    a.awareness.setLocalStateField('user', 'ada');
    const sent = a.sendAwareness();
    await until(
      () => a.awarenessFrames().length > 0 && b.awarenessFrames().length > 0,
      'awareness to be relayed',
    );

    // Byte-for-byte the same message on both screens, sender included (which is
    // what keeps an idle client's traffic counter moving).
    expect(Array.from(b.awarenessFrames()[b.awarenessFrames().length - 1]!.payload)).toEqual(
      Array.from(sent),
    );
    expect(Array.from(a.awarenessFrames()[a.awarenessFrames().length - 1]!.payload)).toEqual(
      Array.from(sent),
    );
    expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({ user: 'ada' });

    // QueryAwareness is answered by nobody in this story (presence is story 6).
    const before = [a.frames.length, b.frames.length];
    a.sendQueryAwareness();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect([a.frames.length, b.frames.length]).toEqual(before);
  });

  it('TC-17: two boards never see each other', async () => {
    const room1 = newBoardId();
    const room2 = newBoardId();
    const alice = await join(room1);
    const bob = await join(room2);

    createSticky(alice.doc, { x: 1, y: 1 });
    createSticky(alice.doc, { x: 2, y: 2 });
    await until(() => alice.boardSnapshot().length === 2, 'notes to apply in room 1');
    // Give any (incorrect) cross-board broadcast a chance to arrive.
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(bob.boardSnapshot()).toEqual([]);
    expect(bob.updateFrames()).toEqual([]);

    createSticky(bob.doc, { x: 3, y: 3 });
    await until(() => bob.boardSnapshot().length === 1, 'note to apply in room 2');
    expect(alice.boardSnapshot().length).toBe(2);
  });

  it('TC-18: a room that lost its document is repopulated by the first client back', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    const first = createSticky(a.doc, { x: 0, y: 0 });
    const second = createSticky(b.doc, { x: 200, y: 0 });
    await until(() => snapshotsEqual(a.boardSnapshot(), b.boardSnapshot()), 'both notes to merge');

    // The runtime goes away: every socket drops and the in-memory doc is lost.
    a.close();
    b.close();
    await until(() => a.isOffline && b.isOffline, 'sockets to drop');

    // A room with an empty document (a fresh object id is exactly that).
    const restarted = newBoardId();
    const probe = await join(restarted);
    expect(probe.boardSnapshot()).toEqual([]);
    probe.close();

    // The first client back fills it from the board it still holds.
    const carrier = await join(restarted);
    Y.applyUpdate(carrier.doc, Y.encodeStateAsUpdate(a.doc));
    carrier.flushLocalUpdates();

    // The second client back converges, and nothing was lost.
    const follower = await join(restarted);
    await until(() => follower.boardSnapshot().length === 2, 'the repopulated board to arrive');
    expect(follower.boardSnapshot().map((n) => n.id).sort()).toEqual([first, second].sort());
    expect(snapshotsEqual(follower.boardSnapshot(), carrier.boardSnapshot())).toBe(true);
  });

  it('TC-31: a connection that died mid-edit does not break the room', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    createSticky(a.doc, { x: 0, y: 0 });
    await until(() => b.boardSnapshot().length === 1, 'note to reach B');

    // B's connection dies without a clean shutdown on the room's side.
    b.close(4000);
    await until(() => b.isOffline, 'the dead socket to be noticed');

    // The room must not throw when it next broadcasts to that socket.
    const next = createSticky(a.doc, { x: 900, y: 0 });
    const late = await join(boardId);
    await until(() => late.boardSnapshot().some((n) => n.id === next), 'change to reach a newcomer');
    expect(a.closes).toEqual([]);
    expect(late.boardSnapshot().length).toBe(2);

    // B comes back and catches up.
    await b.reconnect();
    expect(snapshotsEqual(b.boardSnapshot(), a.boardSnapshot())).toBe(true);
  });
});
