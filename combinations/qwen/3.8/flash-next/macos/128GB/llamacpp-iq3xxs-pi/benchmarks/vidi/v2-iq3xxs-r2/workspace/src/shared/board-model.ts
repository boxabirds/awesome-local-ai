import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';
import { rectContains, type Point, type Rect } from './geometry';

/**
 * The board document model: the Yjs schema plus every mutation the client performs
 * (and, from story 4, the Durable Object performs). Framework-free on purpose, and it
 * never throws for user-driven input: a rejected change returns `false` and opens no
 * transaction, so nothing is synced or persisted.
 *
 * Schema (the future persisted and wire contract, `meta.schemaVersion` = 1):
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string, Y.Map>
 *       <id>: Y.Map { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 */

/** Transaction origin of everything this client does (story 8 undo, story 3 echo guard). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Schema version written to `meta.schemaVersion` by `initDoc`. */
export const SCHEMA_VERSION = 1;

/** Y.Map name holding `{ schemaVersion }`. */
export const META_MAP = 'meta';
/** Y.Map name holding `<id, Y.Map>`; `useBoardDoc` observes it deeply. */
export const OBJECTS_MAP = 'objects';

/** The object type this story's renderer knows; unknown types are skipped. */
export const STICKY_TYPE = 'sticky';

/**
 * Any board object as the model reads it (story 7). `width`/`height` are read with a
 * fallback, so an object created before sizes existed keeps the size it was drawn at.
 */
export interface ObjectSnapshotBase {
  id: string;
  /** The object type; a type this build does not know is skipped by select-all. */
  type: string;
  /** Top-left in world units. */
  x: number;
  y: number;
  /** Stacking order; higher is drawn on top. */
  z: number;
  /** Size in world units. */
  width: number;
  height: number;
  /** False for an object this build cannot render or select. */
  known: boolean;
}

export interface StickySnapshot extends ObjectSnapshotBase {
  type: 'sticky';
  color: StickyColor;
  text: string;
  createdAt: number;
  known: true;
}

/** Any object this build read out of the document, sticky notes included. */
export type ObjectSnapshot = ObjectSnapshotBase | StickySnapshot;

/**
 * Is this a sticky note? The `type` of a general object is any string — it is read from a
 * document that may hold types this build has never seen — so the check needs saying.
 */
export function isStickySnapshot(object: ObjectSnapshot): object is StickySnapshot {
  return object.type === STICKY_TYPE;
}

type YObject = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<YObject> {
  return doc.getMap<YObject>(OBJECTS_MAP);
}

function metaOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META_MAP);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(point: { x: number; y: number } | undefined): point is { x: number; y: number } {
  return !!point && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

/** Runtime colour validation: the doc can hold anything once story 3 syncs. */
export function isStickyColor(value: unknown): value is StickyColor {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(STICKY_COLORS, value)
  );
}

/**
 * `crypto.randomUUID` where available (browsers, Node 19+); the fallback only exists
 * for a jsdom/worker environment that withholds `crypto`, and is still collision-safe
 * enough for a single client (which is all this story has).
 */
/**
 * A fresh object id. Another object type's creator takes one from here so every id on the
 * board has the same shape, whatever module made the object.
 */
export function newObjectId(): string {
  return newId();
}

/** Highest `z` in the document (0 when it holds no objects); new objects go above all. */
export function topZ(doc: Y.Doc): number {
  return maxZ(objectsOf(doc));
}

function newId(): string {
  const cryptoRef: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (typeof cryptoRef?.randomUUID === 'function') return cryptoRef.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Highest `z` currently in the document (0 when there are no objects). */
function maxZ(objects: Y.Map<YObject>): number {
  let max = 0;
  objects.forEach((item) => {
    if (!(item instanceof Y.Map)) return;
    const z = item.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  });
  return max;
}

/**
 * Creates `meta` with `schemaVersion` when it is missing. Idempotent, so story 4 can
 * call it on every load.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = metaOf(doc);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Creates a yellow sticky note centred on `at` (world units): the stored `x`/`y` is
 * the top-left, i.e. `at` minus half `STICKY_SIZE_WORLD`. `z = maxZ + 1`, so a new note
 * is on top of every other one. Returns the new id, or `false` for a non-finite point
 * or an unknown colour.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!isPoint(at)) return false;
  if (!isStickyColor(color)) return false;
  const id = newId();
  const offset = STICKY_SIZE_WORLD / 2;
  doc.transact(() => {
    const objects = objectsOf(doc);
    const item = new Y.Map<unknown>();
    item.set('type', STICKY_TYPE);
    item.set('x', at.x - offset);
    item.set('y', at.y - offset);
    item.set('color', color);
    item.set('text', new Y.Text(''));
    item.set('z', maxZ(objects) + 1);
    item.set('createdAt', Date.now());
    objects.set(id, item);
  }, LOCAL_ORIGIN);
  return id;
}

/** True while `id` names an object in the document. */
export function objectExists(doc: Y.Doc, id: string): boolean {
  return id.length > 0 && objectsOf(doc).has(id);
}

function objectOf(doc: Y.Doc, id: string): YObject | undefined {
  if (!id) return undefined;
  const item = objectsOf(doc).get(id);
  return item instanceof Y.Map ? item : undefined;
}

/**
 * Writes a new top-left position (world units). Returns false for a stale id, a
 * non-finite coordinate, or when the position already is `x`/`y`.
 *
 * Since story 7 this is `moveObjects` with one entry, so a single drag and a group drag
 * go through the same code and the same single transaction.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

/**
 * Raises `id` above every other object (`z = maxZ + 1`). Returns false for a stale id
 * or when the object is already topmost, so story 3 never syncs a pointless change.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/**
 * Sets the note colour, leaving text, position, stacking and creation time untouched.
 * Returns false for a stale id, a non-sticky object, an unknown colour name, or when
 * the note already has that colour.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== STICKY_TYPE) return false;
  if (item.get('color') === color) return false;
  doc.transact(() => {
    item.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes the object (and its `Y.Text`) from the document. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** The note's shared text, or undefined when the note is gone or not a sticky. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const item = objectOf(doc, id);
  if (!item || item.get('type') !== STICKY_TYPE) return undefined;
  const text = item.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function readSize(item: YObject): { width: number; height: number } {
  const width = item.get('width');
  const height = item.get('height');
  return {
    width: isFiniteNumber(width) ? width : STICKY_SIZE_WORLD,
    height: isFiniteNumber(height) ? height : STICKY_SIZE_WORLD,
  };
}

/**
 * The object types this build can read, and therefore draw and select. Sticky notes are
 * in it from the start; `registerObjectType` adds a type when a renderer registers for
 * it, and an object of any other type is reported as not `known` — skipped by select-all
 * and by the marquee, because there is nothing to select it with (TC-08).
 */
const READABLE_TYPES = new Set<string>([STICKY_TYPE]);

export function isObjectTypeKnown(type: string): boolean {
  return READABLE_TYPES.has(type);
}

/** Declares that this build understands `type`; called by the object registry. */
export function markObjectTypeKnown(type: string): void {
  if (typeof type === 'string' && type.length > 0) READABLE_TYPES.add(type);
}

/**
 * A generic object as far as the model is concerned: everything an object type has in
 * common. A sticky note reads through `readSticky` instead, because it has more fields.
 */
function readObject(id: string, item: YObject): ObjectSnapshot | undefined {
  if (item.get('type') === STICKY_TYPE) return readSticky(id, item);
  const type = item.get('type');
  if (typeof type !== 'string' || type.length === 0) return undefined;
  const x = item.get('x');
  const y = item.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;
  const z = item.get('z');
  return {
    id,
    type,
    x,
    y,
    ...readSize(item),
    z: isFiniteNumber(z) ? z : 0,
    known: isObjectTypeKnown(type),
  };
}

function readSticky(id: string, item: YObject): StickySnapshot | undefined {
  if (item.get('type') !== STICKY_TYPE) return undefined;
  const x = item.get('x');
  const y = item.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;
  const colorValue = item.get('color');
  const z = item.get('z');
  const createdAt = item.get('createdAt');
  const text = item.get('text');
  return {
    id,
    type: STICKY_TYPE,
    x,
    y,
    ...readSize(item),
    color: isStickyColor(colorValue) ? colorValue : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : typeof text === 'string' ? text : '',
    z: isFiniteNumber(z) ? z : 0,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    known: true,
  };
}

function compareObjects(a: ObjectSnapshot, b: ObjectSnapshot): number {
  if (a.z !== b.z) return a.z - b.z;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Every object in the document — sticky notes and any other type the document holds —
 * sorted by `(z, id)` so every client paints the same order even when concurrent edits
 * produce equal `z` values. An object of a type this build does not know is included
 * with `known: false` (it can still be drawn once a renderer registers), but never
 * selected (TC-08).
 */
export function objectSnapshots(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects: ObjectSnapshot[] = [];
  objectsOf(doc).forEach((item, id) => {
    if (!(item instanceof Y.Map)) return;
    const object = readObject(id, item);
    if (object) objects.push(object);
  });
  objects.sort(compareObjects);
  return objects;
}

/**
 * The immutable list of sticky notes to render. Kept as its own entry point because
 * every story up to 6 draws only stickies; story 7 draws `objectSnapshots` instead.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return objectSnapshots(doc).filter(
    (object): object is StickySnapshot => object.type === STICKY_TYPE,
  );
}

/* -------------------------------------------------------------------------
 * Story 7: the generic operations every object type shares. Each one takes
 * ids rather than a single object, writes in one transaction, and returns how
 * many objects it changed, so "nothing changed" costs nobody a sync.
 * ---------------------------------------------------------------------- */

/** Where an object is, as a rectangle in world units (the box the handles are drawn around). */
export function objectBounds(object: ObjectSnapshot): Rect {
  return { x: object.x, y: object.y, width: object.width, height: object.height };
}

/**
 * The ids of the objects that lie *entirely* within `rect` — the marquee rule (TC-07) —
 * in render order. Objects of a type this build does not know are never selected.
 */
export function objectsInRect(objects: readonly ObjectSnapshot[], rect: Rect): string[] {
  return objects
    .filter((object) => object.known && rectContains(rect, objectBounds(object)))
    .map((object) => object.id);
}

/** Every id select-all may select: known types only (TC-08). */
export function allObjectIds(objects: readonly ObjectSnapshot[]): string[] {
  return objects.filter((object) => object.known).map((object) => object.id);
}

/**
 * Writes a new top-left for every entry of `positions` in one transaction, skipping ids
 * that are gone (somebody else deleted them) and objects that are already there. One
 * non-finite coordinate rejects the whole call and opens no transaction (TC-09):
 * a half-moved selection is worse than one that did not move.
 *
 * Positions are written as absolute values, which is why several people dragging
 * different selections at once converges (live.multi): there is no relative delta to
 * apply twice.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;
  const writes: Array<{ item: YObject; x: number; y: number }> = [];
  for (const [id, at] of positions) {
    if (!isPoint(at)) return 0;
    const item = objectOf(doc, id);
    if (!item) continue;
    if (item.get('x') === at.x && item.get('y') === at.y) continue;
    writes.push({ item, x: at.x, y: at.y });
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const write of writes) {
      write.item.set('x', write.x);
      write.item.set('y', write.y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/** The raw box of an object, with the same fallbacks the snapshot uses. */
function boundsOfItem(item: YObject): Rect | undefined {
  const x = item.get('x');
  const y = item.get('y');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;
  return { x, y, ...readSize(item) };
}

function isUsableRect(rect: Rect | undefined): rect is Rect {
  return (
    !!rect &&
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/**
 * Writes a new box (position *and* size) for every entry of `rects` in one transaction.
 * Ids that are gone are skipped; one unusable box rejects the whole call, and a box that
 * already is the requested one is not counted, so a drag that never crossed the resize
 * threshold syncs nothing.
 *
 * The first resize of a sticky note made before this story writes `width` and `height`
 * explicitly; nothing migrated them at build time (TC-10).
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  const writes: Array<{ item: YObject; rect: Rect }> = [];
  for (const [id, rect] of rects) {
    if (!isUsableRect(rect)) return 0;
    const item = objectOf(doc, id);
    if (!item) continue;
    const current = boundsOfItem(item);
    if (
      current &&
      current.x === rect.x &&
      current.y === rect.y &&
      current.width === rect.width &&
      current.height === rect.height
    ) {
      continue;
    }
    writes.push({ item, rect });
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const { item, rect } of writes) {
      item.set('x', rect.x);
      item.set('y', rect.y);
      item.set('width', rect.width);
      item.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Lifts a whole selection above every object that is not in it (TC-06), keeping the
 * order the selection already had: `ids` is read bottom-first, so the first id gets the
 * lowest new `z`. Ids that are gone are skipped, and a selection that is already on top
 * writes nothing.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsOf(doc);
  const items: YObject[] = [];
  for (const id of ids) {
    const item = objectOf(doc, id);
    if (item) items.push(item);
  }
  if (items.length === 0) return 0;
  const top = maxZ(objects);
  const lifted = items.filter((item) => {
    const z = item.get('z');
    return !isFiniteNumber(z) || z < top;
  });
  if (lifted.length === 0) return 0;
  let next = top;
  doc.transact(() => {
    for (const item of lifted) {
      next += 1;
      item.set('z', next);
    }
  }, LOCAL_ORIGIN);
  return lifted.length;
}

/**
 * Removes every object named by `ids` in one transaction, skipping ids that are gone, so
 * deleting a selection somebody else has partly deleted leaves a clean board rather than
 * an error (TC-31).
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsOf(doc);
  const present = ids.filter((id) => objectOf(doc, id) !== undefined);
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}
