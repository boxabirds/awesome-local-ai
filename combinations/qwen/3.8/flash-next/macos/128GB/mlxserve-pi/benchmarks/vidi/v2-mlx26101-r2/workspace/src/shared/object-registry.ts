/**
 * The board's object-type registry (story 7, widened by stories 9-12).
 *
 * This module exists so that *adding an object type does not require importing
 * it*. A type's module tells this registry four things when it is loaded - that
 * the type exists, how to read one of its maps into a snapshot, how big one is
 * when it carries no size of its own - and `board-model` reads the answers back
 * when it snapshots or moves the board. None of it is a type import: an object
 * type module imports `board-model` (for `LOCAL_ORIGIN` and the field names), and
 * a `board-model` that imported the type module back would be a cycle whose
 * outcome depends on which file the test loaded first. Keeping the mutable state
 * here, in a module that imports nothing at run time, makes that cycle harmless
 * in both directions.
 *
 * Framework-free and Yjs-typed only: the room (story 5) and the Worker import
 * `board-model`, and neither may pull in React or the DOM.
 */

import type * as Y from 'yjs';

import type { ObjectSnapshot } from './board-model.js';
import { STICKY_SIZE_WORLD } from './config.js';

/** The object type board-model was written with; stories 9-12 add others. */
export const STICKY_TYPE = 'sticky';

/**
 * The object types board-model knows how to read, move, resize and restack.
 *
 * This is deliberately a *board-model* set rather than the client's render
 * registry: board-model is framework-free (the room imports it), so it cannot
 * import `src/client/objects/registry.tsx`. When the client registry registers a
 * type it calls {@link registerBoardObjectType} so the two agree on which types
 * are real, and a group operation refuses an object of a type board-model has
 * never heard of (a `bringToFront` of an unknown object is still `false`).
 */
const boardObjectTypes = new Set<string>([STICKY_TYPE]);

/**
 * Tell board-model about an object type the client registry has registered,
 * so group operations (move, resize, stack, delete) will act on it.
 */
export function registerBoardObjectType(type: string): void {
  if (typeof type === 'string' && type.length > 0) boardObjectTypes.add(type);
}

/** Whether board-model recognises `type` as a movable, resizable object. */
export function isKnownObjectType(type: unknown): type is string {
  return typeof type === 'string' && boardObjectTypes.has(type);
}

/**
 * Turns one object map into the snapshot its own type needs. Story 9's text
 * objects register one so their extra fields (`size`, `widthMode`) reach the
 * client through `objectSnapshot` instead of every renderer having to know how to
 * read a text object; a type without a reader gets the generic reader in
 * board-model, which is enough to draw and to move.
 *
 * The reader lives with the type, so a story 9-12 module can add a type without
 * board-model having to import it (which it must not: the room imports board-model
 * and nothing of the client's).
 */
export type ObjectSnapshotReader = (id: string, map: Y.Map<unknown>) => ObjectSnapshot | undefined;

const objectSnapshotReaders = new Map<string, ObjectSnapshotReader>();

/** Give a type its own snapshot reader. */
export function registerObjectSnapshotReader(type: string, reader: ObjectSnapshotReader): void {
  if (typeof type === 'string' && type.length > 0) objectSnapshotReaders.set(type, reader);
}

/** The reader a type registered, if any. */
export function objectSnapshotReader(type: unknown): ObjectSnapshotReader | undefined {
  return typeof type === 'string' ? objectSnapshotReaders.get(type) : undefined;
}

/**
 * How big an object of a type is when it carries no width or height of its own: a
 * sticky note is a `STICKY_SIZE_WORLD` square, which is what makes a note created
 * before story 7 keep its size without any migration. A type whose box is derived
 * from something else - an arrow, whose box is its two ends - registers 0, so an
 * arrow that runs perfectly vertically is drawn as the line it is instead of being
 * padded out to the size of a note.
 */
const defaultSizes = new Map<string, number>([[STICKY_TYPE, STICKY_SIZE_WORLD]]);

/** Say how big an object of `type` is when it stores no size. */
export function registerDefaultObjectSize(type: string, size: number): void {
  if (typeof type === 'string' && type.length > 0 && Number.isFinite(size) && size >= 0) {
    defaultSizes.set(type, size);
  }
}

/** The default size of `type`, or the sticky note's for anything unknown. */
export function defaultObjectSize(type: string | undefined): number {
  const size = type === undefined ? undefined : defaultSizes.get(type);
  return size === undefined ? STICKY_SIZE_WORLD : size;
}
