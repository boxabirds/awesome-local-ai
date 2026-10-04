/**
 * persist.room, inside workerd: what the live server cannot show.
 *
 * TC-16/TC-26 (the rate limit itself) - a board recorded as broken is not read
 * again by a room that wakes onto it, however many rooms wake onto it, until
 * LOAD_RETRY_MIN_INTERVAL_MS has passed; then the next wake reads it. This needs a
 * real eviction, and `evictDurableObject` exists only in the vitest pool. A second
 * reason matters: `wrangler dev`'s clock jumps forward by more than the retry
 * interval when it puts a socketless room away, so the interval itself is only
 * measurable somewhere time behaves. Here it does.
 *
 * TC-18 - the room's audience. See that test for how far this toolchain can take
 * the claim: neither `evictDurableObject` (which does not return while a
 * hibernatable socket is open) nor `ctx.abort()` (which closes the sockets along
 * with the object) can show a connection surviving the object that accepted it.
 * What is shown here is the room's half of that arrangement; the live project
 * shows the rest.
 */

import * as Y from 'yjs';
import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { retroBoard } from '../fixtures/boards';
import type { BoardRoom, Env as WorkerEnv } from '../../src/worker/index';

const namespace = (env as unknown as WorkerEnv).BOARD_ROOM;

function roomFor(boardId: string): DurableObjectStub<BoardRoom> {
  return namespace.get(namespace.idFromName(boardId));
}

/**
 * Put the object away and wake it again, reporting what the new instance knows.
 * Waking happens through the object itself, because constructing it is the wake:
 * the constructor reads the board before anything else may run.
 */
async function wake(room: DurableObjectStub<BoardRoom>): Promise<{
  state: string;
  failedAt: number | null;
  retryDue: boolean;
}> {
  await evictDurableObject(room);
  return runInDurableObject(room, (inst) => ({
    state: inst.roomState,
    failedAt: inst.loadFailureTime,
    retryDue: inst.retryDue(),
  }));
}

/**
 * The other end of a socket pair, kept referenced by this isolate. A socket with no
 * peer anywhere is not one the runtime would be asked to hold.
 */
function held(): unknown[] {
  const store = globalThis as unknown as { __heldSockets?: unknown[] };
  return (store.__heldSockets ??= []);
}

/** Move the recorded failure back in time, as waiting for the interval would. */
function ageTheFailure(stub: DurableObjectStub<BoardRoom>, ms: number): Promise<unknown> {
  return runInDurableObject(stub, (_inst, ctx) => {
    ctx.storage.sql.exec(
      `UPDATE storage_meta SET value = ? WHERE key = 'load_failed_at'`,
      String(Date.now() - ms),
    );
  });
}

describe('board room lifecycle (workerd)', () => {
  /**
   * The room keeps no list of connections of its own - that is the point of
   * `acceptWebSocket`, and the only arrangement under which a connection can
   * outlive the object that accepted it. Everything the room sends goes to
   * `ctx.getWebSockets()`: whatever the runtime holds is the audience.
   */
  it('TC-18: the room\u2019s audience is the runtime\u2019s socket set', async () => {
    const boardId = newBoardId();
    const room = roomFor(boardId);

    const result = await runInDurableObject(room, (inst, ctx) => {
      // A connection made the way `fetch` makes one: the object accepts it, and the
      // runtime is the one holding it from then on.
      const [peer, server] = Object.values(new WebSocketPair());
      held().push(peer);
      ctx.acceptWebSocket(server);
      const counted = inst.socketCount();

      // A change made now has to be written and handed to that socket. The room
      // closes a peer it cannot reach, so the socket still being open at the end is
      // the answer to "was it treated as a participant?".
      const scratch = new Y.Doc();
      retroBoard(scratch);
      inst.applySeed(Y.encodeStateAsUpdate(scratch));

      return {
        counted,
        listed: ctx.getWebSockets().length,
        state: inst.roomState,
        stored: inst.store.summary().updateCount,
        notes: inst.noteCount(),
        open: ctx.getWebSockets().every((socket) => socket.readyState === WebSocket.OPEN),
      };
    });

    // The room's own count and the runtime's list are the same one socket: there is
    // nowhere else it could have been counted.
    expect(result.counted).toBe(1);
    expect(result.listed).toBe(1);
    expect(result.state).toBe('ready');
    expect(result.notes).toBeGreaterThan(0);
    expect(result.stored).toBe(1);
    expect(result.open).toBe(true);
  });

  it('TC-16: a board recorded as broken is not read again until the interval has passed', async () => {
    const boardId = newBoardId();
    const room = roomFor(boardId);

    // A board that reads fine carries no failure.
    const healthy = await runInDurableObject(room, (inst) => ({
      state: inst.roomState,
      failedAt: inst.loadFailureTime,
    }));
    expect(healthy.state).toBe('ready');
    expect(healthy.failedAt).toBeNull();

    // The next read fails. The room says so, and writes down the moment it gave up.
    const broken = await runInDurableObject(room, (inst) => {
      inst.armLoadFailures(1);
      const load = inst.reloadBoard();
      return { load, state: inst.roomState, error: inst.lastLoadError, failedAt: inst.loadFailureTime };
    });
    expect(broken.load.ok).toBe(false);
    expect(broken.state).toBe('load-failed');
    expect(broken.error).toContain('injected read failure');
    expect(broken.failedAt).toBeTypeOf('number');
    const marker = broken.failedAt as number;

    // Wakes: each one constructs a room that knows nothing, and each one refuses to
    // read the board, because the failure and its time are in storage rather than in
    // the memory of an object that no longer exists. The recorded time is the
    // evidence: a room that read the board and failed would have written a newer
    // time, and a room that read it successfully would have cleared it.
    for (let attempt = 0; attempt < 3; attempt++) {
      const woken = await wake(room);
      expect(woken.state).toBe('load-failed');
      expect(woken.failedAt).toBe(marker);
      expect(woken.retryDue).toBe(false);
    }

    // Time passes. The next wake reads the board, and it is the board.
    await ageTheFailure(room, LOAD_RETRY_MIN_INTERVAL_MS + 1_000);
    const recovered = await wake(room);
    expect(recovered.state).toBe('ready');
    expect(recovered.failedAt).toBeNull();
  });
});
