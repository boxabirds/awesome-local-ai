/**
 * The board document model (story 2).
 *
 * Sticky notes live in a Yjs document from day one: the same document story 3
 * puts on the network and story 4 persists. That is why the shape below is
 * deliberately boring and versioned - it becomes the wire and the storage
 * format - and why every rejection is expressed as `false` instead of an
 * exception.
 *
 * The module is framework-free and free of DOM access so the Durable Object
 * (story 4) can import the very same validation and migration code.
 *
 * Schema:
 * ```
 * Y.Doc
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<string, Y.Map>
 *     <id>: Y.Map {
 *       type: 'sticky'
 *       x: number, y: number   // top-left corner, world units
 *       color: StickyColor
 *       text: Y.Text
 *       z: number              // stacking, higher is on top
 *       createdAt: number      // epoch ms
 *     }
 * ```
 */
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/**
 * Transaction origin for local mutations. Story 8 uses it to build undo
 * stacks and story 3 to avoid echoing a change back to its author.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6:local');

/** Written to `meta.schemaVersion`; bumped when the shape above changes. */
export const SCHEMA_VERSION = 1;

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
}

type NoteMap = Y.Map<unknown>;

/** The one `objects` map every board object lives in. */
export function objectsMap(doc: Y.Doc): Y.Map<NoteMap | unknown> {
  return doc.getMap<NoteMap | unknown>(OBJECTS_KEY);
}

function isSticky(value: unknown): value is NoteMap {
  return value instanceof Y.Map && value.get('type') === 'sticky';
}

function readNote(doc: Y.Doc, id: string): NoteMap | undefined {
  const value = objectsMap(doc).get(id);
  return isSticky(value) ? value : undefined;
}

function finite(...values: unknown[]): boolean {
  return values.every((value) => typeof value === 'number' && Number.isFinite(value));
}

/** Highest `z` currently in the document; new notes and drags start above it. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((value) => {
    if (!isSticky(value)) return;
    const z = value.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/** Prepare a document for use, recording the schema version exactly once. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META_KEY);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (the coordinates are the centre, not
 * the top-left corner: `x, y` stored on the note is `at` minus half the note
 * size). Returns the new id, or `''` when the point is unusable.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!finite(at?.x, at?.y)) return '';
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `sticky-${Math.random().toString(36).slice(2)}`;
  const z = maxZ(doc) + 1;
  const objects = objectsMap(doc);
  const fill = color in STICKY_COLORS ? color : DEFAULT_STICKY_COLOR;

  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', fill);
    note.set('text', new Y.Text());
    note.set('z', z);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

/** Move a note to a new top-left corner. False for a stale id or bad numbers. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const note = readNote(doc, id);
  if (!note) return false;
  if (!finite(x, y)) return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raise a note above every other one. False when it is already on top, which
 * keeps a pointless update off the wire in story 3.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const note = readNote(doc, id);
  if (!note) return false;
  const z = note.get('z');
  if (typeof z !== 'number' || !Number.isFinite(z)) return false;
  const top = maxZ(doc);
  if (z >= top) return false;
  doc.transact(() => {
    note.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Recolour a note. False for a stale id, an unknown colour or no change. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const note = readNote(doc, id);
  if (!note) return false;
  if (!(color in STICKY_COLORS)) return false;
  if (note.get('color') === color) return false;
  doc.transact(() => {
    note.set('color', color as StickyColor);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note and its text. False for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!readNote(doc, id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's text type, or undefined when the note is gone. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = readNote(doc, id);
  if (!note) return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Read the whole board as plain data, in render order: by `z` ascending, then
 * by `id`. Painting the array in order therefore puts the highest `z` last,
 * which is what the browser draws on top. The `id` tie-break makes an
 * equal-`z` race (possible once story 3 syncs) resolve to the same order on
 * every client. Objects of an unknown `type` are skipped so a newer client can
 * open a document written by an older one.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objectsMap(doc).forEach((value, id) => {
    if (!isSticky(value)) return;
    const x = value.get('x');
    const y = value.get('y');
    const z = value.get('z');
    const createdAt = value.get('createdAt');
    if (!finite(x, y, z)) return; // hand-edited or half-written entry
    const storedColor = value.get('color');
    const text = value.get('text');
    notes.push({
      id,
      type: 'sticky',
      x: x as number,
      y: y as number,
      color:
        typeof storedColor === 'string' && storedColor in STICKY_COLORS
          ? (storedColor as StickyColor)
          : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: z as number,
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
    });
  });
  notes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}