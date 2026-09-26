// Shared helpers for the story 4 integration tests (workerd pool).
//
// Storage is read through the room's test-only RPC methods (the design's
// "runInDurableObject" step): the workerd test pool has no such host, and a
// DO method runs inside the object's isolate against its real storage.

import { env } from 'cloudflare:test';
import * as Y from 'yjs';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model';

/** The room stub for a board id (constructs the object on first call). */
export function room(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Apply a full-state snapshot byte string to a fresh doc and snapshot it. */
export function stateToNotes(state: ArrayBuffer): readonly StickySnapshot[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state), 'test');
  const notes = snapshot(doc);
  doc.destroy();
  return notes;
}

/** Semantic board equality (same helper the story 3 tests use). */
export function sameBoard(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a.length !== b.length) return false;
  const key = (n: StickySnapshot) =>
    `${n.id}|${n.x}|${n.y}|${n.color}|${n.text}|${n.z}|${n.createdAt}`;
  const sorted = (s: readonly StickySnapshot[]) => s.map(key).sort();
  return sorted(a).every((k, i) => k === sorted(b)[i]);
}

/** The note ids of a snapshot set. */
export function ids(notes: readonly StickySnapshot[]): string[] {
  return notes.map((n) => n.id);
}

/** Copy bytes into an exactly-sized ArrayBuffer (safe for RPC results). */
export function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}
