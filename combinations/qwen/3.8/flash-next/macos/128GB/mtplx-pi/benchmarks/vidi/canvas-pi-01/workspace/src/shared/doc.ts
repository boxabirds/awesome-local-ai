/**
 * Story 10 · the plumbing every object-type module shares (design "Files added
 * or changed": the object modules must reach the `objects` map, the transaction
 * origin and the stacking order *without* importing `board-model`).
 *
 * `board-model.ts` used to own all three; shapes and connectors now need them
 * too, and importing the model back into itself would close an import cycle
 * (`board-model` derives connector geometry, so it has to import the connector
 * module). They therefore live here, and `board-model.ts` re-exports
 * {@link LOCAL_ORIGIN} so every existing `import { LOCAL_ORIGIN } from
 * './board-model'` keeps working with the *same* symbol — the undo manager and
 * the provider filter on identity, so there can be only one.
 */
import * as Y from 'yjs';
import { STICKY_SIZE_WORLD } from './config';
import type { Rect } from './geometry';

/**
 * Transaction origin for local edits. Story 8's undo manager and story 3's
 * provider distinguish local from remote changes by origin, so every local
 * mutation is tagged with this single symbol.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** A record in the `objects` map: one Y.Map per board object. */
export type ObjectRecord = Y.Map<unknown>;

/** The shared `objects` map. Never created lazily inside a read. */
export function objectsOf(doc: Y.Doc): Y.Map<ObjectRecord> {
  return doc.getMap<ObjectRecord>('objects');
}

/** True when the record exists and is of `type`. */
export function recordIsType(
  record: ObjectRecord | undefined,
  type: string,
): record is ObjectRecord {
  return record !== undefined && record.get('type') === type;
}

/**
 * Highest `z` currently in the document, whatever the object type (0 when
 * empty). Every create raises to `topZ + 1`, so a connector drawn after a shape
 * still lands on top of it.
 */
export function topZ(doc: Y.Doc): number {
  let top = 0;
  objectsOf(doc).forEach((record) => {
    const z = record.get('z');
    if (typeof z === 'number' && z > top) top = z;
  });
  return top;
}

/** A stable identifier. Falls back where `crypto.randomUUID` is unavailable. */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback for exotic runtimes; still effectively unique.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** True when every argument is a usable coordinate. */
export function finite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

/** A stored size, or the default sticky size when a document predates sizes. */
export function readSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : STICKY_SIZE_WORLD;
}

/**
 * The live rectangle of one record, or `null` for a record that has none (a
 * connector's box is derived, so it never contributes one).
 */
export function rectOfRecord(record: ObjectRecord): Rect | null {
  if (record.get('type') === 'connector') return null;
  const x = record.get('x');
  const y = record.get('y');
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  return { x, y, width: readSize(record.get('width')), height: readSize(record.get('height')) };
}

/**
 * Every object's live rectangle, keyed by id — the input
 * `resolveEndpoints` needs. Reading the map is cheap, and this is called at
 * most once per user gesture (connector creation), not per pointer move.
 */
export function objectRects(doc: Y.Doc): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  objectsOf(doc).forEach((record, id) => {
    const rect = rectOfRecord(record);
    if (rect) rects.set(id, rect);
  });
  return rects;
}
