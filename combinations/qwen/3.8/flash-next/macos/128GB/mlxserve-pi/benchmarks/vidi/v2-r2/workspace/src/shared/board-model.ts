// Board document model: the Yjs schema and every mutation the board performs.
//
// This module is the persisted and wire contract: story 3 attaches a network
// provider to this document and story 4 persists the same document, so the
// schema below is what ends up on disk and on the wire. It is framework-free
// (no React, no DOM) so the Durable Object can import it for validation and
// migration.
//
// Schema
//   meta:    Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map> where each object is
//     { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
//   (x, y) is the note's top-left in world units; higher z draws on top.
//
// Every successful mutation is exactly one transaction carrying LOCAL_ORIGIN, so
// story 8 can group them for undo and story 3 can skip its own echo. Rejected
// input (stale id, unknown colour, non-finite coordinate, already topmost) opens
// no transaction at all and returns false: never throws for user-driven input.

import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

/** Transaction origin of every local mutation. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Version of the document schema written into `meta.schemaVersion`. */
export const SCHEMA_VERSION = 1;

const META = 'meta';
const OBJECTS = 'objects';
const TYPE_STICKY = 'sticky';

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

export interface PointLike {
  x: number;
  y: number;
}

type YObject = Y.Map<unknown>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(META);
}

function objectsMap(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>(OBJECTS);
}

/**
 * The object as a note the model owns, or null when it is absent, is another
 * type (stories 9-12 will add some), or is too damaged to draw. The type check
 * is what makes unknown types invisible rather than an error.
 */
function stickyMapOf(doc: Y.Doc, id: string): YObject | null {
  if (typeof id !== 'string' || id === '') return null;
  const object = objectsMap(doc).get(id);
  if (!(object instanceof Y.Map)) return null;
  if (object.get('type') !== TYPE_STICKY) return null;
  if (!(object.get('text') instanceof Y.Text)) return null;
  if (!isFiniteNumber(object.get('x'))) return null;
  if (!isFiniteNumber(object.get('y'))) return null;
  if (!isFiniteNumber(object.get('z'))) return null;
  return object;
}

/** Read one object; null when it is not a sticky this story can render. */
function readSticky(id: string, object: YObject): StickySnapshot | null {
  if (object.get('type') !== TYPE_STICKY) return null;
  const x = object.get('x');
  const y = object.get('y');
  const z = object.get('z');
  const text = object.get('text');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  if (!(text instanceof Y.Text)) return null;
  const color = object.get('color');
  const createdAt = object.get('createdAt');
  return {
    id,
    type: TYPE_STICKY,
    x,
    y,
    // a colour this build does not know (a newer client added one) keeps the
    // note visible on the default instead of hiding the user's idea
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text.toString(),
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  };
}

/** Stacking order: z ascending, ids breaking ties so every client agrees. */
function compareStack(a: StickySnapshot, b: StickySnapshot): number {
  return a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The note that is last in the stacking order, or null for an empty board. */
function topmost(doc: Y.Doc): { id: string; z: number } | null {
  let top: { id: string; z: number } | null = null;
  for (const [id, object] of objectsMap(doc)) {
    const z = object.get('z');
    if (!isFiniteNumber(z) || object.get('type') !== TYPE_STICKY) continue;
    if (top === null || z > top.z || (z === top.z && id > top.id)) top = { id, z };
  }
  return top;
}

/** Highest z on the board, 0 when there are no notes, so the first note gets z 1. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const object of objectsMap(doc).values()) {
    const z = object.get('z');
    if (isFiniteNumber(z) && z > max && object.get('type') === TYPE_STICKY) max = z;
  }
  return max;
}

/** Prepare a document for use: writes `meta.schemaVersion` when it is absent. */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Add a note centred on `at` (the stored position is the top-left), on top of
 * every other note. Returns its id, or '' when the point is not usable.
 */
export function createSticky(doc: Y.Doc, at: PointLike, color?: StickyColor): string {
  if (
    at === null ||
    typeof at !== 'object' ||
    !isFiniteNumber(at.x) ||
    !isFiniteNumber(at.y)
  ) {
    return '';
  }
  const fill: StickyColor = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
  const id = newId();
  const z = maxZ(doc) + 1;
  const objects = objectsMap(doc);
  const half = STICKY_SIZE_WORLD / 2;
  doc.transact(() => {
    const object = new Y.Map<unknown>();
    object.set('type', TYPE_STICKY);
    object.set('x', at.x - half);
    object.set('y', at.y - half);
    object.set('color', fill);
    object.set('z', z);
    object.set('createdAt', Date.now());
    object.set('text', new Y.Text());
    objects.set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note to a new top-left. False when the id or a coordinate is bad. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const object = stickyMapOf(doc, id);
  if (object === null) return false;
  if (object.get('x') === x && object.get('y') === y) return true; // already there
  doc.transact(() => {
    object.set('x', x);
    object.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raise a note above every other one. False when it is already the topmost note,
 * so a drag that only jitters never emits a pointless sync update (story 3).
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const object = stickyMapOf(doc, id);
  if (object === null) return false;
  const top = topmost(doc);
  if (top !== null && top.id === id) return false;
  const z = maxZ(doc) + 1;
  doc.transact(() => {
    object.set('z', z);
  }, LOCAL_ORIGIN);
  return true;
}

/** Recolour a note, touching nothing else. Unknown colour names are rejected. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const object = stickyMapOf(doc, id);
  if (object === null) return false;
  if (object.get('color') === color) return true; // already that colour
  doc.transact(() => {
    object.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object from the board. False when there is nothing to remove. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  if (typeof id !== 'string' || id === '') return false;
  const objects = objectsMap(doc);
  if (!(objects.get(id) instanceof Y.Map)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, or undefined when the id is not a readable note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = stickyMapOf(doc, id);
  if (object === null) return undefined;
  const text = object.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Every renderable note, in draw order (bottom to top). Unknown types and
 * unreadable objects are skipped, so a newer client's shapes do not break this
 * renderer. The array is freshly built: callers memoise it.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, object] of objectsMap(doc)) {
    const note = readSticky(id, object);
    if (note !== null) notes.push(note);
  }
  notes.sort(compareStack);
  return notes;
}

/** Stacking comparator, exported for the renderer's own ordering checks. */
export function compareStacking(a: StickySnapshot, b: StickySnapshot): number {
  return compareStack(a, b);
}

/**
 * Every renderable note in the order it was created: the order the renderer puts
 * the notes in the DOM. `snapshot` answers which note is drawn on top; this
 * answers where each note lives. A note's element is never moved after it is
 * placed - the browser stacks it by its `z` value instead - because moving an
 * element that has the pointer captured ends the drag that is using it.
 */
export function snapshotByCreation(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, object] of objectsMap(doc)) {
    const note = readSticky(id, object);
    if (note !== null) notes.push(note);
  }
  return notes;
}

function newId(): string {
  const cryptoRef: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (cryptoRef !== undefined && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  // a deterministic-enough fallback for engines without crypto.randomUUID
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
