/**
 * Story 4 · integration tests for the test-only storage hooks (the worker half
 * of TC-24, plus the production-shape check).
 *
 * Everything here runs in workerd against a real SQLite-backed Durable Object:
 * a snapshot is written, made unreadable, and the room's *own* connection path
 * is used to observe what a client would get. The repair case then proves the
 * same room serves the restored board again, which is the property the browser
 * test (`tests/e2e/broken-board.spec.ts`) depends on.
 */
import { abortAllDurableObjects, env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import worker from '../../src/worker/index';
import { BoardStore, resetTestHooks } from '../../src/worker/board-store';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import { parseTestHook, testHooksEnabled } from '../../src/worker/test-hooks';
import { RoomClient } from './helpers/room-client';

afterEach(async () => {
  resetTestHooks();
  abortAllDurableObjects();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

function roomId(name: string): string {
  const id = name.padEnd(22, 'x').slice(0, 22);
  if (!/^[a-zA-Z0-9_-]{22}$/.test(id)) throw new Error(`bad room id ${id}`);
  return id;
}

/** The hook environment (`wrangler dev --env e2e` sets the same variable). */
const hookEnv = { ...env, TEST_HOOKS: '1' };

async function callHook(
  boardId: string,
  action: string,
  environment: Record<string, unknown> = hookEnv,
): Promise<Response> {
  return worker.fetch(
    new Request(`http://inner/__test/boards/${boardId}/${action}`, { method: 'POST' }),
    environment as unknown as Parameters<typeof worker.fetch>[1],
  );
}

async function openClient(boardId: string): Promise<RoomClient> {
  const response = await worker.fetch(
    new Request(`http://inner/api/rooms/${boardId}`, {
      headers: {
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
      },
    }),
    env,
  );
  const socket = response.webSocket;
  if (socket === undefined || socket === null) {
    throw new Error(`no socket: status ${response.status}`);
  }
  socket.accept();
  return new RoomClient(socket);
}

/** Build a three-note board and store it as a snapshot in the room's storage. */
async function seedSnapshot(boardId: string): Promise<number> {
  const doc = new Y.Doc();
  initDoc(doc);
  for (let i = 0; i < 3; i += 1) createSticky(doc, { x: i * 100, y: i * 50 });
  const ns = env.BOARD_ROOM;
  if (ns === undefined) throw new Error('BOARD_ROOM binding missing');
  const stub = ns.get(ns.idFromName(boardId));
  await runInDurableObject(stub, (_instance, state) => {
    const store = new BoardStore(state.storage);
    store.migrate();
    store.append(Y.encodeStateAsUpdate(doc));
    // Force the compaction: a three-note board would never reach the
    // thresholds, and the hooks need a snapshot to damage.
    const compacted = store.compactIfNeeded(doc, true);
    if (!compacted) throw new Error('seeding compaction did not run');
  });
  // Forget the object's memory so the next connection goes through a real
  // start-up load of what we just wrote (the local stand-in for a restart).
  abortAllDurableObjects();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return snapshot(doc).length;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100));

describe('test hooks', () => {
  it('parse: only the two known actions on a well-formed board id', () => {
    const id = roomId('parse-check');
    expect(parseTestHook(`/__test/boards/${id}/corrupt-snapshot`)).toEqual({
      boardId: id,
      action: 'corrupt-snapshot',
    });
    expect(parseTestHook(`/__test/boards/${id}/repair-snapshot`)!.action).toBe(
      'repair-snapshot',
    );
    // Negative half: not a hook path, unknown action, short id, no action.
    expect(parseTestHook('/api/rooms/' + id)).toBeNull();
    expect(parseTestHook(`/__test/boards/${id}/delete-everything`)).toBeNull();
    expect(parseTestHook(`/__test/boards/${id.slice(0, 20)}/corrupt-snapshot`)).toBeNull();
    expect(parseTestHook(`/__test/boards/${id}`)).toBeNull();
  });

  it('the routes only exist when TEST_HOOKS=1', () => {
    expect(testHooksEnabled({ TEST_HOOKS: '1' })).toBe(true);
    expect(testHooksEnabled({})).toBe(false);
    expect(testHooksEnabled({ TEST_HOOKS: 'true' })).toBe(false);
    expect(testHooksEnabled(undefined)).toBe(false);
  });

  it('without TEST_HOOKS the route is not a way into a room (TC-24 production shape)', async () => {
    const boardId = roomId('hooks-disabled');
    const count = await seedSnapshot(boardId);
    expect(count).toBe(3);

    const response = await callHook(boardId, 'corrupt-snapshot', { ...env });
    const body = await response.text();
    expect(body).not.toContain('corrupted');
    expect(body).not.toContain('"ok":true');

    // And the board is untouched: a client still gets its three notes.
    const client = await openClient(boardId);
    await settle();
    expect(snapshot(client.doc).length).toBe(3);
  });

  it('corrupt → honest 4500 with no content; repair → the board is back (TC-24)', async () => {
    const boardId = roomId('hooks-broken');
    expect(await seedSnapshot(boardId)).toBe(3);

    // Damage it.
    const corrupt = await callHook(boardId, 'corrupt-snapshot');
    expect(corrupt.status).toBe(200);
    expect((await corrupt.json()).ok).toBe(true);

    // A client that arrives now is told the truth instead of being handed an
    // empty, editable board: the socket closes with 4500 and no content.
    const broken = await openClient(boardId);
    await settle();
    expect(broken.closeCodes).toEqual([4500]);
    expect(snapshot(broken.doc).length).toBe(0);

    // Repair, and the *same* room serves the restored board again.
    const repair = await callHook(boardId, 'repair-snapshot');
    expect(repair.status).toBe(200);
    expect((await repair.json()).ok).toBe(true);

    const recovered = await openClient(boardId);
    await settle();
    expect(recovered.closeCodes).toEqual([]);
    expect(snapshot(recovered.doc).length).toBe(3);
  });

  it('repair with nothing corrupted reports that plainly', async () => {
    const boardId = roomId('hooks-noop');
    const response = await callHook(boardId, 'repair-snapshot');
    expect(response.status).toBe(409);
    expect((await response.json()).ok).toBe(false);
  });
});
