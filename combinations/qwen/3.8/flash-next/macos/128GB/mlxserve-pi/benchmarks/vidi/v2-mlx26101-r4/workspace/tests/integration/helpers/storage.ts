/**
 * Reaching into a board's room from a test.
 *
 * Two ways, and the difference between them is the point. `inRoom` runs a function *inside* the
 * Durable Object with `cloudflare:test`'s helper, which is the only way to get at the storage
 * itself — its rows, its damaged bytes, the lines it wrote while it was working. `callInternal`
 * makes a request to the room the way the Worker's test hooks do, which is what an end-to-end
 * test has to do and what these tests use when they want the room to act on its own board (fold
 * its log away, put a damaged snapshot back).
 */
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';

import { isStickySnapshot, snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import type { BoardRoom } from '../../../src/worker/board-room';
import type { BoardStats } from '../../../src/worker/board-store';

/** The room namespace, as the class the tests know rather than as `cloudflare:test` types it. */
export function rooms(): DurableObjectNamespace<BoardRoom> {
  return env.BOARD_ROOM as unknown as DurableObjectNamespace<BoardRoom>;
}

/** A handle to one board's room, which is what eviction and requests are aimed at. */
export type RoomStub = ReturnType<DurableObjectNamespace<BoardRoom>['get']>;

export function stubFor(boardId: string): RoomStub {
  return rooms().get(rooms().idFromName(boardId));
}

/** Run a function inside a board's room, on its storage. */
export function inRoom<T>(boardId: string, work: (room: BoardRoom) => T): Promise<T> {
  return runInDurableObject(stubFor(boardId), (room: BoardRoom) => work(room));
}

/**
 * Ask a board's room to do one of its internal routes, and hand back what it answered.
 *
 * This is the request `src/worker/test-hooks.ts` makes on behalf of a browser, made here
 * directly: the same object, the same routes, the same storage.
 */
export async function callInternal<T>(boardId: string, route: string, query = ''): Promise<T> {
  // The routes that change something are POSTed, like the hooks make them: a request that only
  // asks is not allowed to be the one that writes.
  const reads = ['stats', 'lines', 'state'];
  const response = await stubFor(boardId).fetch(
    new Request(`https://board-room.internal/x/${route}${query}`, { method: reads.includes(route) ? 'GET' : 'POST' }),
  );
  if (response.status !== 200) throw new Error(`${route} gave ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

/** What is stored about a board, as the room counts it. */
export function storedStats(boardId: string): Promise<BoardStats> {
  return inRoom(boardId, (room) => room.store.stats());
}

/** What the room said while it was working, oldest first. */
export function storedLines(boardId: string): Promise<string[]> {
  return inRoom(boardId, (room) => [...room.store.lines]);
}

/**
 * The notes in a board's storage, read into a document of the test's own.
 *
 * This is not what a client sees: a client sees what the room is holding. This reads the storage
 * from the outside, which is the only way to ask "is the note actually in there" without taking
 * the room's word for it.
 */
export async function storedNotes(boardId: string): Promise<readonly StickySnapshot[]> {
  return inRoom(boardId, (room) => {
    const doc = new Y.Doc();
    if (!room.store.load(doc).ok) throw new Error(`board ${boardId} would not load`);
    const notes = snapshot(doc).filter(isStickySnapshot);
    doc.destroy();
    return notes;
  });
}
