// Integration helpers that look at the room side of the wire.

import { env, listDurableObjectIds, runInDurableObject } from 'cloudflare:test';
import type * as Y from 'yjs';
import { snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import type { Env } from '../../../src/worker/index';
import type { BoardRoom } from '../../../src/worker/board-room';

/** The Worker's bindings, as the runtime sees them. */
export const bindings = env as unknown as Env;

/** The board ids that currently have a live BoardRoom object. */
export async function liveRoomIds(): Promise<string[]> {
  const ids = await listDurableObjectIds(bindings.BOARD_ROOM);
  return ids.map((id) => id.toString());
}

/**
 * One board's Durable Object, addressed by its id. Story 5 gave the object two
 * Durable Object RPC methods — `initialize()` and `exists()` — which are what
 * POST /api/boards and GET /api/boards/:boardId call, so a test that needs a known
 * id creates the board the same way instead of poking at private fields.
 */
export function roomStub(
  boardId: string,
): ReturnType<DurableObjectNamespace<BoardRoom>['get']> {
  return bindings.BOARD_ROOM.get(bindings.BOARD_ROOM.idFromName(boardId));
}

/**
 * Create a board (the `initialize()` RPC behind POST /api/boards). Since story 5 a
 * room refuses a WebSocket for a board that was never created, so this is the
 * prerequisite for connecting — and it is idempotent.
 */
export async function createRoom(
  boardId: string,
): Promise<'created' | 'exists' | 'failed'> {
  return roomStub(boardId).initialize();
}

/** Does this board exist? The `exists()` RPC behind GET /api/boards/:boardId. */
export async function roomExists(boardId: string): Promise<boolean> {
  return roomStub(boardId).exists();
}

/**
 * The document as the room itself holds it, read from inside the Durable Object.
 * A board that never received an update is reported as an empty board.
 */
export async function roomSnapshot(
  boardId: string,
): Promise<readonly StickySnapshot[]> {
  const stub = bindings.BOARD_ROOM.get(bindings.BOARD_ROOM.idFromName(boardId));
  const json = await runInDurableObject(stub, (instance: BoardRoom) => {
    const doc = (instance as unknown as { roomDoc: Y.Doc | null }).roomDoc;
    return JSON.stringify(doc ? snapshot(doc) : []);
  });
  return JSON.parse(String(json)) as readonly StickySnapshot[];
}

/** Wait until the room's own document satisfies `predicate`. */
export async function waitForRoom(
  boardId: string,
  predicate: (notes: readonly StickySnapshot[]) => boolean,
  message = `room ${boardId} never reached the expected state`,
): Promise<readonly StickySnapshot[]> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const notes = await roomSnapshot(boardId);
    if (predicate(notes)) return notes;
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Wait until the room's document contains a note with this id. */
export function waitForRoomNote(boardId: string, noteId: string) {
  return waitForRoom(
    boardId,
    (notes) => notes.some((note) => note.id === noteId),
    `room ${boardId} never received note ${noteId}`,
  );
}
