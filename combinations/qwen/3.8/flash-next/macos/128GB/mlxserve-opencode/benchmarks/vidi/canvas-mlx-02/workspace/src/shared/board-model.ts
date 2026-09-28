// Yjs board model (story 2). Framework-free module: the client imports it now,
// the story-4 Durable Object will import it for validation/migration.
//
// Schema (the future persisted + wire format):
//   meta:    Y.Map { schemaVersion: number }
//   objects: Y.Map<id, Y.Map> where each value is
//     { type, x, y, color, text: Y.Text, z, createdAt }
import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config.ts';
import type { Point, Rect } from './geometry.ts';
import { rectContains } from './geometry.ts';

export const SCHEMA_VERSION = 1;

export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

// Object types this build of the board model can read. Stories 2-7 ship
// 'sticky'; each later object type becomes readable when its client registry
// entry is registered (registerReadableType), and an object of a type nobody
// has registered is invisible — forward compatibility, TC-12).
type ReadableType = string;
const KNOWN_TYPES = new Set<ReadableType>(['sticky']);

// Mark a board object type as readable by the board model. Called by the
// client object registry so ONE registration per type exists (stories 9-12
// call registerObjectType and nothing else); test-only types call it too.
export function registerReadableType(type: string): void {
  if (typeof type !== 'string' || type === '') return;
  KNOWN_TYPES.add(type);
}

// A board object of any readable type, with the fields every object shares.
// Sticky notes add color/text; `width`/`height` are optional (story 7):
// objects created before this story have neither and render at
// STICKY_SIZE_WORLD; the first resize writes both fields explicitly.
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
  width?: number;
  height?: number;
  color?: StickyColor;
  text?: string;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
  createdAt: number;
}

const STICKY_TYPE = 'sticky';

// Known colour names (the six product presets).
const COLOR_NAMES = new Set<string>([
  'yellow',
  'orange',
  'green',
  'blue',
  'pink',
  'violet',
]);

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>('meta');
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function isColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && COLOR_NAMES.has(value);
}

// A usable world coordinate is a finite number.
function isCoord(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.get('schemaVersion') === undefined) {
    // init runs outside the user-mutation origin so it is not mistaken for a
    // user edit; still one transaction.
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

function readSticky(id: string, m: Y.Map<unknown>): StickySnapshot | null {
  if (m.get('type') !== STICKY_TYPE) return null; // forward-compat: skip unknown types
  const text = m.get('text');
  return {
    id,
    type: 'sticky',
    x: Number(m.get('x')),
    y: Number(m.get('y')),
    color: isColor(m.get('color')) ? (m.get('color') as StickyColor) : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: Number(m.get('z')),
    createdAt: Number(m.get('createdAt')),
  };
}

// Sort order: (z ascending, id as a stable tie-break) so concurrent equal z
// values render identically on every client.
function order(a: { z: number; id: string }, b: { z: number; id: string }): number {
  return a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objectsMap(doc).forEach((m, id) => {
    const s = readSticky(id, m);
    if (s) out.push(s);
  });
  out.sort(order);
  return out;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((m) => {
    const z = Number(m.get('z'));
    if (Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  // Inputs are validated before opening a transaction; never throws for
  // user-driven input. Non-finite points fall back to the origin.
  const ax = isCoord(at?.x) ? at.x : 0;
  const ay = isCoord(at?.y) ? at.y : 0;
  const col = isColor(color) ? color : DEFAULT_STICKY_COLOR;

  let newId = '';
  doc.transact(() => {
    newId = crypto.randomUUID();
    const m = new Y.Map<unknown>();
    m.set('type', STICKY_TYPE);
    m.set('x', ax - STICKY_SIZE_WORLD / 2); // centred on the click point
    m.set('y', ay - STICKY_SIZE_WORLD / 2);
    m.set('color', col);
    m.set('text', new Y.Text(''));
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    objectsMap(doc).set(newId, m);
  }, LOCAL_ORIGIN);
  return newId;
}

// Look up a sticky Y.Map by id; returns undefined when missing or not sticky.
function getStickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsMap(doc).get(id);
  if (!m || m.get('type') !== STICKY_TYPE) return undefined;
  return m;
}

// The objects map, for tests that need to seed raw state.
export function objectsMapOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return objectsMap(doc);
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  // Story 2 single-object wrapper over the generic group operation.
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  // Story 2 single-object wrapper: bring one object above all others.
  return bringObjectsToFront(doc, [id]) === 1;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  if (!isColor(color)) return false; // unknown colour name
  if (m.get('color') === color) return false; // no-op: avoid pointless traffic
  doc.transact(() => {
    m.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  // Story 2 single-object wrapper over the generic group operation.
  return deleteObjects(doc, [id]) === 1;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = getStickyMap(doc, id);
  if (!m) return undefined;
  const text = m.get('text');
  return text instanceof Y.Text ? text : undefined;
}

// --- Generic group operations (story 7) --------------------------------------
// Every mutating group call: rejects non-finite inputs / empty id lists with 0
// and NO transaction, skips ids that are missing or of an unknown type, and
// otherwise performs exactly one LOCAL_ORIGIN transaction, returning the count
// of objects actually changed.

// A usable size is a finite, strictly positive number.
function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

// Read one object of any known type; null for unknown types or unusable data
// (a non-finite coordinate makes the whole object invisible, never a NaN rect).
function readObject(id: string, m: Y.Map<unknown>): ObjectSnapshot | null {
  const type = m.get('type');
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) return null;
  const x = m.get('x');
  const y = m.get('y');
  const z = m.get('z');
  if (!isCoord(x) || !isCoord(y) || !isCoord(z)) return null;
  const createdAt = Number(m.get('createdAt'));
  const obj: { -readonly [K in keyof ObjectSnapshot]: ObjectSnapshot[K] } = {
    id,
    type,
    x,
    y,
    z,
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
  };
  const w = m.get('width');
  const h = m.get('height');
  if (isSize(w)) obj.width = w;
  if (isSize(h)) obj.height = h;
  if (type === STICKY_TYPE) {
    obj.color = isColor(m.get('color')) ? (m.get('color') as StickyColor) : DEFAULT_STICKY_COLOR;
    const text = m.get('text');
    obj.text = text instanceof Y.Text ? text.toString() : '';
  }
  return obj;
}

// Every readable object, sorted by (z, id) like `snapshot`.
export function objectsSnapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  objectsMap(doc).forEach((m, id) => {
    const o = readObject(id, m);
    if (o) out.push(o);
  });
  out.sort(order);
  return out;
}

// The world-space bounds of an object. An object without persisted
// width/height (created before story 7) falls back to STICKY_SIZE_WORLD; the
// first resize writes both fields explicitly (TC-10).
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width = isSize(obj.width) ? obj.width : STICKY_SIZE_WORLD;
  const height = isSize(obj.height) ? obj.height : STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width, height };
}

// Marquee hit rule (TC-07): only objects ENTIRELY inside the rect; an object
// merely touched by the rect is not selected. A non-finite rect selects
// nothing.
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  if (
    !rect ||
    !isCoord(rect.x) ||
    !isCoord(rect.y) ||
    !isCoord(rect.width) ||
    !isCoord(rect.height)
  ) {
    return [];
  }
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (rectContains(rect, objectBounds(obj))) ids.push(obj.id);
  }
  return ids;
}

// Select-all rule (TC-08): every readable object; unknown types are already
// excluded by the snapshot reader and filtered again defensively.
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  const ids: string[] = [];
  for (const obj of snapshot) {
    if (KNOWN_TYPES.has(obj.type)) ids.push(obj.id);
  }
  return ids;
}

// Collect (id, Y.Map) pairs for ids that exist and are readable.
function existingMaps(
  doc: Y.Doc,
  ids: readonly string[],
): Array<[string, Y.Map<unknown>]> {
  const objects = objectsMap(doc);
  const seen = new Set<string>();
  const out: Array<[string, Y.Map<unknown>]> = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const m = objects.get(id);
    if (!m) continue;
    if (!KNOWN_TYPES.has(String(m.get('type')))) continue;
    out.push([id, m]);
  }
  return out;
}

// Move objects to ABSOLUTE world positions. Invalid positions are skipped;
// missing ids are skipped; one transaction for the whole group.
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, Point>,
): number {
  if (!positions || positions.size === 0) return 0;
  const targets: Array<[Y.Map<unknown>, number, number]> = [];
  for (const [id, p] of positions) {
    if (!p || !isCoord(p.x) || !isCoord(p.y)) continue;
    const found = existingMaps(doc, [id]);
    if (found.length === 0) continue;
    targets.push([found[0][1], p.x, p.y]);
  }
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const [m, x, y] of targets) {
      m.set('x', x);
      m.set('y', y);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

// Resize objects to ABSOLUTE world rects, writing x, y, width and height. An
// implicit-size sticky becomes explicit on its first resize (TC-10). Invalid
// rects are skipped; missing ids are skipped; one transaction.
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (!rects || rects.size === 0) return 0;
  const targets: Array<[Y.Map<unknown>, Rect]> = [];
  for (const [id, r] of rects) {
    if (
      !r ||
      !isCoord(r.x) ||
      !isCoord(r.y) ||
      !isSize(r.width) ||
      !isSize(r.height)
    ) {
      continue;
    }
    const found = existingMaps(doc, [id]);
    if (found.length === 0) continue;
    targets.push([found[0][1], r]);
  }
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const [m, r] of targets) {
      m.set('x', r.x);
      m.set('y', r.y);
      m.set('width', r.width);
      m.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return targets.length;
}

// Raise the listed objects above every unlisted object, keeping their relative
// stacking order (sorted by current (z, id), reassigned consecutive z above
// the highest unselected z). Returns the count whose z actually changed.
export function bringObjectsToFront(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  const objects = objectsMap(doc);
  const found = existingMaps(doc, ids);
  if (found.length === 0) return 0;
  const sel = new Set(found.map(([id]) => id));
  let maxUnselected = 0;
  objects.forEach((m, id) => {
    if (sel.has(id)) return;
    const z = Number(m.get('z'));
    if (Number.isFinite(z) && z > maxUnselected) maxUnselected = z;
  });
  const entries = found
    .map(([id, m]) => ({ id, m, z: Number(m.get('z')) }))
    .sort((a, b) => order({ z: a.z, id: a.id }, { z: b.z, id: b.id }));
  const changes: Array<[Y.Map<unknown>, number]> = [];
  entries.forEach((e, rank) => {
    const nextZ = maxUnselected + rank + 1;
    // Only ever RAISE an object: one already above the unselected top keeps its
    // z (bringToFront on the topmost is a no-op, story 2 TC-10).
    if (Number.isFinite(e.z) && e.z >= nextZ) return;
    changes.push([e.m, nextZ]);
  });
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const [m, z] of changes) m.set('z', z);
  }, LOCAL_ORIGIN);
  return changes.length;
}

// Delete the listed objects; missing ids are skipped; one transaction.
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const objects = objectsMap(doc);
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id) || !objects.has(id)) continue;
    seen.add(id);
    targets.push(id);
  }
  if (targets.length === 0) return 0;
  doc.transact(() => {
    for (const id of targets) objects.delete(id);
  }, LOCAL_ORIGIN);
  return targets.length;
}
