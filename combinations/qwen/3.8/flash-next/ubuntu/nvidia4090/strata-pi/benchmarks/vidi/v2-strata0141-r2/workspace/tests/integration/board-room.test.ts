import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { evictDurableObject, env as testEnv } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';
import type { Env } from '../../src/worker';
import {
  awarenessUpdate,
  boards,
  boardsAgree,
  closeAll,
  connectedClient,
  reconnectClient,
  type SyncClient,
  waitFor,
} from './helpers/sync-client';
import { logSeed, runRandomOps, COLOR_NAMES } from './helpers/ops';

/**
 * BoardRoom (`sync.room`, design TC-07 to TC-18, TC-31).
 *
 * Real Durable Object, real WebSockets, real Yjs: two clients hold their own
 * `Y.Doc` and only talk through the room, so "everyone sees the same board" is
 * observed the way the browser observes it.
 */

async function pair(): Promise<[SyncClient, SyncClient, string]> {
  const boardId = newBoardId();
  const a = await connectedClient('A', boardId);
  const b = await connectedClient('B', boardId);
  return [a, b, boardId];
}

/** A note the board model accepted; it only returns null for bad input. */
function mustId(value: string | null): string {
  if (value === null) {
    throw new Error('the board model rejected the note');
  }
  return value;
}

/** Count only frames that arrive after this point (skips the sync handshake). */
function mark(...clients: SyncClient[]): number[] {
  return clients.map((client) => client.frames.length);
}

function newFrames(client: SyncClient, from: number): typeof client.frames {
  return client.frames.slice(from);
}

async function settled(...clients: SyncClient[]): Promise<void> {
  await waitFor(() => boardsAgree(...clients), 10_000, 'all clients to hold the same board');
}

describe('one writer, one observer (TC-07, TC-08)', () => {
  it('shows another person the note a writer created, exactly once (TC-07)', async () => {
    const [a, b] = await pair();
    const [markA, markB] = mark(a, b);

    const id = a.createNote({ x: 10, y: 20 }, 'yellow');
    expect(id).toBeTruthy();

    await waitFor(() => b.board.length === 1, 5_000, 'B to see the new note');
    expect(JSON.stringify(b.board)).toEqual(JSON.stringify(a.board));
    expect(newFrames(b, markB)).toHaveLength(1);
    // The writer is never echoed its own change.
    expect(newFrames(a, markA)).toHaveLength(0);

    closeAll(a, b);
  });

  it('propagates every kind of change and echoes none of them (TC-08)', async () => {
    const [a, b] = await pair();
    const id = a.createNote({ x: 0, y: 0 }, 'yellow');
    await settled(a, b);
    expect(id).toBeTruthy();

    const changes: Array<{ name: string; apply: () => void }> = [
      { name: 'move', apply: () => a.move(id!, 140, -60) },
      { name: 'recolour', apply: () => a.recolour(id!, 'blue') },
      { name: 'text insert', apply: () => a.type(id!, 0, 'drag here ') },
      { name: 'text insert in the middle', apply: () => a.type(id!, 5, 'only ') },
      { name: 'delete', apply: () => a.remove(id!) },
    ];

    for (const change of changes) {
      const [markA, markB] = mark(a, b);
      change.apply();
      await waitFor(
        () => JSON.stringify(b.board) === JSON.stringify(a.board),
        5_000,
        `B to see A's ${change.name}`,
      );
      expect(newFrames(b, markB).filter((frame) => frame.kind === 'sync')).toHaveLength(1);
      expect(newFrames(a, markA).filter((frame) => frame.kind === 'sync')).toHaveLength(0);
    }

    expect(a.board).toEqual([]);
    expect(b.board).toEqual([]);
    closeAll(a, b);
  });
});

describe('two writers on the same note (TC-09, TC-10, TC-11)', () => {
  it('keeps simultaneous typing on one note and shows it identically (TC-09, live.concurrent_text)', async () => {
    const [a, b] = await pair();
    const id = mustId(a.createNote({ x: 0, y: 0 }));
    a.type(id, 0, 'green');
    await settled(a, b);
    expect(a.textOf(id)).toBe('green');
    expect(b.textOf(id)).toBe('green');

    // Neither client has heard from the other yet: both edit from 'green'.
    a.type(id, 0, 'red ');
    expect(b.textOf(id)).toBe('green');
    b.type(id, 5, ' blue');
    expect(a.textOf(id)).toBe('red green');

    await settled(a, b);
    expect(a.textOf(id)).toBe('red green blue');
    expect(b.textOf(id)).toBe('red green blue');

    closeAll(a, b);
  });

  it('settles simultaneous moves of one note to one position (TC-10, live.converge)', async () => {
    const [a, b] = await pair();
    const id = mustId(a.createNote({ x: 0, y: 0 }));
    await settled(a, b);

    a.move(id, 100, 100);
    b.move(id, 300, 300);

    await settled(a, b);
    const fromA = a.note(id)!;
    const fromB = b.note(id)!;
    expect([fromA.x, fromA.y]).toEqual([fromB.x, fromB.y]);
    expect([[100, 100], [300, 300]]).toContainEqual([fromA.x, fromA.y]);

    closeAll(a, b);
  });

  it('deletes a note even while someone else is typing in it (TC-11, TC-25 negative)', async () => {
    const [a, b] = await pair();
    const id = mustId(a.createNote({ x: 0, y: 0 }));
    a.type(id, 0, 'working on ');
    await settled(a, b);

    // A deletes while B keeps typing in the same note, unaware of the delete.
    a.remove(id);
    b.type(id, 11, 'this text arrives during the delete');

    await settled(a, b);
    expect(a.board).toEqual([]);
    expect(b.board).toEqual([]);
    expect(b.textOf(id)).toBeUndefined();
    expect(JSON.stringify(b.board)).not.toContain('this text arrives during the delete');
    expect(JSON.stringify(a.board)).not.toContain('this text arrives during the delete');

    closeAll(a, b);
  });
});

describe('a full room (TC-12, TC-14)', () => {
  it(
    `keeps ${MAX_CONCURRENT_EDITORS} writers identical after 200 random operations each (TC-12, live.capacity)`,
    async () => {
      const boardId = newBoardId();
      const clients: SyncClient[] = [];
      for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
        clients.push(await connectedClient(`writer-${index}`, boardId));
      }

      const seedBase = 20260729;
      const reports = clients.map((client, index) => {
        const seed = seedBase + index;
        logSeed(`TC-12 writer-${index}`, seed);
        return runRandomOps(client, seed, 200);
      });

      await settled(...clients);

      const everyBoard = boards(...clients);
      for (const [index, board] of everyBoard.entries()) {
        expect(board, `writer ${index} ended with a different board`).toEqual(everyBoard[0]);
      }

      // Every note a writer created is on the board unless somebody deleted it.
      const present = new Set(clients[0].board.map((note) => note.id));
      for (const report of reports) {
        for (const id of report.surviving) {
          expect(present.has(id), `created note ${id} missing`).toBe(true);
        }
      }
      const totalDeletes = reports.reduce((sum, report) => sum + report.applied.delete, 0);
      expect(clients[0].board.length).toBeGreaterThan(0);
      expect(totalDeletes).toBeGreaterThan(0);

      closeAll(...clients);
    },
  );

  it('shows a late joiner everything the others created (TC-14, live.join_state)', async () => {
    const [a, b, boardId] = await pair();
    for (let index = 0; index < 20; index += 1) {
      a.createNote({ x: index * 40, y: 0 }, COLOR_NAMES[index % COLOR_NAMES.length]);
      b.createNote({ x: 0, y: index * 40 }, COLOR_NAMES[index % COLOR_NAMES.length]);
    }
    await settled(a, b);
    expect(a.board.length).toBe(40);

    const c = await connectedClient('C', boardId);
    await settled(a, b, c);
    expect(c.board.length).toBe(40);
    expect(JSON.stringify(c.board)).toEqual(JSON.stringify(a.board));

    closeAll(a, b, c);
  });
});

describe('traffic the room must not accept (TC-15, TC-16)', () => {
  const badFrames: Array<{ name: string; frame: () => string | Uint8Array }> = [
    { name: 'a text frame', frame: () => 'hello from a text frame' },
    {
      name: 'truncated bytes',
      frame: () => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        encoding.writeVarUint(encoder, syncProtocol.messageYjsSyncStep2);
        encoding.writeVarUint(encoder, 200); // announces 200 bytes, sends 3
        encoding.writeVarUint8Array(encoder, new Uint8Array([1, 2, 3]));
        return encoding.toUint8Array(encoder);
      },
    },
    {
      name: 'an unknown message type',
      frame: () => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 9);
        encoding.writeVarUint8Array(encoder, new Uint8Array([1, 2, 3]));
        return encoding.toUint8Array(encoder);
      },
    },
    {
      name: 'an invalid Yjs update',
      frame: () => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate);
        encoding.writeVarUint8Array(encoder, new Uint8Array([7, 19, 42, 99, 250, 3, 11]));
        return encoding.toUint8Array(encoder);
      },
    },
  ];

  for (const bad of badFrames) {
    it(`closes only the sender who sent ${bad.name} (TC-15)`, async () => {
      const [a, b, boardId] = await pair();
      const c = await connectedClient('C', boardId);
      const noteId = mustId(c.createNote({ x: 0, y: 0 }, 'yellow'));
      await settled(b, c);
      const before = JSON.stringify(b.board);

      a.sendRaw(bad.frame());
      const close = await a.closedAt;
      expect(close.code).toBe(CLOSE_UNSUPPORTED_DATA);

      // The other participants are untouched and still get changes.
      expect(b.isOpen).toBe(true);
      expect(c.isOpen).toBe(true);
      const markB = mark(b)[0];
      const newId = c.createNote({ x: 90, y: 90 }, 'blue');
      await waitFor(() => b.board.some((note) => note.id === newId), 5_000, 'B to still receive updates');
      expect(newFrames(b, markB).filter((frame) => frame.kind === 'sync')).toHaveLength(1);

      // The room's own document was not changed by the bad frame.
      const probe = await connectedClient('probe', boardId);
      await settled(b, c, probe);
      const originalNote = JSON.parse(before).find((note: { id: string }) => note.id === noteId);
      expect(JSON.stringify(probe.note(noteId))).toEqual(JSON.stringify(originalNote));
      expect(probe.board.length).toBe(2);
      expect(a.isOpen).toBe(false);

      closeAll(b, c, probe);
    });
  }

  it('relays awareness bytes to everyone including the sender (TC-16)', async () => {
    const [a, b] = await pair();
    const markA = mark(a)[0];
    const markB = mark(b)[0];

    const payload = awarenessUpdate(a);
    a.sendAwareness(payload);

    await waitFor(() => b.awarenessFrames.length > 0 && a.awarenessFrames.length > 0, 5_000, 'both sockets to receive the awareness bytes');
    const toB = newFrames(b, markB).filter((frame) => frame.kind === 'awareness');
    const toA = newFrames(a, markA).filter((frame) => frame.kind === 'awareness');
    expect(toA.map((frame) => frame.bytes)).toEqual(toB.map((frame) => frame.bytes));

    // Same bytes as they were sent: message type, then the length-prefixed payload.
    const asSent = encoding.createEncoder();
    encoding.writeVarUint(asSent, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(asSent, payload);
    expect(toB[0].bytes).toEqual(encoding.toUint8Array(asSent));

    // QueryAwareness is answered, but not relayed.
    const markA2 = mark(a)[0];
    const markB2 = mark(b)[0];
    a.sendQueryAwareness();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(newFrames(a, markA2).filter((frame) => frame.kind === 'awareness')).toHaveLength(0);
    expect(newFrames(b, markB2)).toHaveLength(0);
    expect(a.isOpen).toBe(true);

    closeAll(a, b);
  });
});

describe('a room that lost its document (TC-18)', () => {
  it('is repopulated by the first client to come back, then converges (sync.catch_up)', async () => {
    const boardId = newBoardId();
    const a = await connectedClient('A', boardId);
    const b = await connectedClient('B', boardId);
    const first = mustId(a.createNote({ x: 0, y: 0 }, 'yellow'));
    a.type(first, 0, 'written before the restart');
    await settled(a, b);

    // A deploy or restart: every socket closes and the object is discarded.
    a.close();
    b.close();
    await waitFor(() => a.readyState === 3 && b.readyState === 3, 5_000, 'both sockets to close');
    const room = testEnv as unknown as Env;
    await evictDurableObject(room.BOARD_ROOM.get(room.BOARD_ROOM.idFromName(boardId)), {
      webSockets: 'close',
    });

    // Proof the room really lost its document: a fresh client sees nothing.
    const probe = await connectedClient('probe', boardId);
    await waitFor(() => probe.frames.length > 0, 5_000, 'the restarted room to answer');
    expect(probe.board.filter((note) => note.id === first)).toEqual([]);
    probe.close();
    await waitFor(() => probe.readyState === 3, 5_000, 'the probe socket to close');

    // A comes back first and repopulates the room from its local copy.
    const aBack = await reconnectClient(a, 'A-back', boardId);
    const bBack = await reconnectClient(b, 'B-back', boardId);
    await settled(aBack, bBack);
    expect(aBack.board.length).toBe(1);
    expect(aBack.textOf(first)).toBe('written before the restart');

    // B's copy was identical, so nothing extra arrives; and a newcomer sees it all.
    const joiner = await connectedClient('joiner', boardId);
    await settled(aBack, bBack, joiner);
    expect(joiner.board.length).toBe(1);
    expect(joiner.textOf(first)).toBe('written before the restart');

    closeAll(aBack, bBack, joiner);
  });
});

describe('a socket that died mid-broadcast (TC-31)', () => {
  it('does not stop the room or the other participants', async () => {
    const [a, b, boardId] = await pair();
    b.close();
    // A sends while B's socket is disappearing: the room must survive it.
    a.createNote({ x: 0, y: 0 }, 'yellow');
    a.createNote({ x: 60, y: 0 }, 'blue');

    await waitFor(() => a.board.length === 2, 5_000, 'A to keep its own notes');
    expect(a.isOpen).toBe(true);

    // Later sockets still receive everything, including the current state.
    const c = await connectedClient('C', boardId);
    await waitFor(() => c.board.length === 2, 5_000, 'the later client to see both notes');
    expect(JSON.stringify(c.board)).toEqual(JSON.stringify(a.board));

    const c2 = await connectedClient('C2', boardId);
    const newId = c2.createNote({ x: 120, y: 0 }, 'green');
    await waitFor(() => a.board.some((note) => note.id === newId), 5_000, 'A to receive from the later client');
    await settled(a, c, c2);

    closeAll(a, c, c2);
  });
});

