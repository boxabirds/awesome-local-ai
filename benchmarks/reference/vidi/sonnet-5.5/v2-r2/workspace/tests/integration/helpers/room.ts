import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { snapshot } from '../../../src/shared/board-model';
import type { BoardRoom } from '../../../src/worker/board-room';

interface RoomEnv { BOARD_ROOM: DurableObjectNamespace<BoardRoom> }

export function roomStub(boardId: string) {
  const ns = (env as unknown as RoomEnv).BOARD_ROOM;
  return ns.get(ns.idFromName(boardId));
}

/** Runs `fn` inside the board's Durable Object with direct access to the instance and storage. */
export function inRoom<T>(
  boardId: string,
  fn: (room: BoardRoom, state: DurableObjectState) => T | Promise<T>,
): Promise<T> {
  return runInDurableObject(roomStub(boardId), fn);
}

export function rowCount(sql: SqlStorage, table: string): number {
  return Number(sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n);
}

export const snap = (doc: Y.Doc) => JSON.stringify(snapshot(doc));
