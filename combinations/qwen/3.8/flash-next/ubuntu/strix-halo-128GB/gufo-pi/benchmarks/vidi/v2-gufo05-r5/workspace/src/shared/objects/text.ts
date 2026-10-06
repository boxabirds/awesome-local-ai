/**
 * The text object: schema and every mutation of it (story 9).
 *
 * ```
 * objects/<id>: Y.Map {
 *   type: 'text', x, y, width, height, z, createdAt, createdBy,
 *   text: Y.Text,           // the characters, shared live
 *   size: 'S'|'M'|'L'|'XL', // a preset key, so a later story can re-tune the px values
 *   widthMode: 'auto'|'fixed'
 * }
 * ```
 *
 * `width` and `height` are stored rather than derived at render time (design key decision 1):
 * selection bounds, marquee and export need them without measuring, and only the client that
 * made a local change measures and writes them, so five screens never re-measure one change.
 *
 * Like the rest of the model, every accepted change is exactly one `LOCAL_ORIGIN`
 * transaction, and every rejection (stale id, unknown size, non-finite number) is decided
 * before a transaction is opened, so it produces no update at all.
 */
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';
import { BOX_ORIGIN, LOCAL_ORIGIN } from '../y-origin';
import type { Point } from '../geometry';

/** The document root every board object lives in (the same root `board-model` reads). */
const OBJECTS_KEY = 'objects';

/**
 * One text object, as rendered by React.
 *
 * The shape of `ObjectSnapshot` (id, type, x, y, z, createdAt, width, height) plus the text
 * fields. It is spelled out rather than `extends ObjectSnapshot`, because `ObjectSnapshot` is
 * the union of every object type and an interface cannot extend a union.
 */
export interface TextSnapshot {
  readonly id: string;
  readonly type: 'text';
  readonly x: number;
  readonly y: number;
  /** Measured box (world units), written by whichever client changed the text. */
  readonly width: number;
  readonly height: number;
  readonly z: number;
  readonly createdAt: number;
  /** Who made it (story 6 identity; empty string when nobody knows). */
  readonly createdBy: string;
  readonly text: string;
  readonly size: TextSize;
  readonly widthMode: 'auto' | 'fixed';
}

/** True when `value` is one of the size preset keys (`S`, `M`, `L`, `XL`). */
export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.hasOwn(TEXT_SIZES, value);
}

/** The font size of a preset, in world units. */
export function textSizePx(size: TextSize): number {
  return TEXT_SIZES[size];
}

/** The height of one line of a preset, in world units. */
export function textLineHeightPx(size: TextSize): number {
  return TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

/**
 * The `Y.Map` of a text object, or undefined for a stale id or another object type.
 *
 * `useTextBoxSync` observes this record, because `size` and `widthMode` live on it; to read a
 * validated snapshot use `readTextObject`.
 */
export function getTextRecord(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const raw = objectsOf(doc).get(id);
  if (!(raw instanceof Y.Map)) return undefined;
  return raw.get('type') === 'text' ? raw : undefined;
}

/** The largest `z` of any object, 0 when the board is empty. */
function topZ(objects: Y.Map<Y.Map<unknown>>): number {
  let top = 0;
  for (const raw of objects.values()) {
    if (!(raw instanceof Y.Map)) continue;
    const z = raw.get('z');
    if (finite(z) && z > top) top = z;
  }
  return top;
}

/**
 * Creates a text object with its **top-left** at `at` (world units), size M, automatic
 * width, no characters, on top of every other object.
 *
 * Returns the new id, or `null` when nothing was written because the point is not finite:
 * a click that never happened must not leave an object behind.
 */
export function createText(doc: Y.Doc, at: Point, createdBy: string): string | null {
  const x = at?.x;
  const y = at?.y;
  if (!finite(x) || !finite(y)) return null;

  const id = crypto.randomUUID();
  const who = typeof createdBy === 'string' ? createdBy : '';
  doc.transact(() => {
    const objects = objectsOf(doc);
    const text = new Y.Map<unknown>();
    text.set('type', 'text');
    text.set('x', x);
    text.set('y', y);
    // a box exists from the first moment, so selection bounds are usable before any measuring
    text.set('width', TEXT_MIN_WIDTH_WORLD);
    text.set('height', textLineHeightPx(DEFAULT_TEXT_SIZE));
    text.set('text', new Y.Text(''));
    text.set('size', DEFAULT_TEXT_SIZE);
    text.set('widthMode', 'auto');
    text.set('z', topZ(objects) + 1);
    text.set('createdAt', Date.now());
    text.set('createdBy', who);
    objects.set(id, text);
  }, LOCAL_ORIGIN);
  return id;
}

/** The object's shared text, for editing. Undefined when the id is stale or not a text. */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = getTextRecord(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Changes the size preset, leaving position alone (PRD text.size: the top-left corner stays).
 * False for an unknown key, a stale id, or the size it already has.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (!isTextSize(size)) return false;
  const text = getTextRecord(doc, id);
  if (!text) return false;
  if (text.get('size') === size) return false; // no-op: nothing to sync
  doc.transact(() => {
    text.set('size', size);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Sets a fixed width (PRD text.fixed_width), clamped up to TEXT_MIN_WIDTH_WORLD.
 *
 * The first call switches `widthMode` to `fixed`; from then on the box width is what the
 * person dragged it to, and only the height follows the content.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!finite(width)) return false;
  const text = getTextRecord(doc, id);
  if (!text) return false;
  const next = Math.max(TEXT_MIN_WIDTH_WORLD, width);
  if (text.get('widthMode') === 'fixed' && text.get('width') === next) return false;
  doc.transact(() => {
    text.set('widthMode', 'fixed');
    text.set('width', next);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Writes the measured box. False when the box is already exactly this, so a remeasure that
 * changed nothing costs no update and no sync traffic (TC-13).
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!finite(box?.width) || !finite(box?.height)) return false;
  const text = getTextRecord(doc, id);
  if (!text) return false;

  // Only the keys that differ are written, so a remeasure that found the box unchanged puts
  // nothing on the wire at all.
  const changed = (['width', 'height'] as const).filter((key) => text.get(key) !== box[key]);
  if (changed.length === 0) return false;
  doc.transact(() => {
    for (const key of changed) text.set(key, box[key]);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Grows the box of a text object to hold what a screen drew, and writes nothing when it fits.
 *
 * The stored box is measured by whoever changed the text, which is right but not infallible:
 * fonts differ between screens, and characters two people type into one text merge into a shape
 * neither of them measured. A screen whose words stick out of the box therefore says so here, and
 * three rules keep that from turning into a fight:
 *
 * - only values *smaller* than the measurement are written, so a box can grow and never shrink,
 *   and the last word always belongs to the client that can see the text is too short;
 * - a `fixed` width belongs to the person who dragged it, so it is never widened here whatever the
 *   caller asks, and only the height moves - the words wrap inside the width they were given;
 * - the write carries {@link BOX_ORIGIN}, not `LOCAL_ORIGIN`: it syncs to everybody, but it is not
 *   something the person did, so it is not an undo step and undo can never cut text off again.
 *
 * Returns whether anything was written.
 */
export function growTextBox(
  doc: Y.Doc,
  id: string,
  needed: { width: number; height: number },
  widen: boolean,
): boolean {
  if (!finite(needed?.width) || !finite(needed?.height)) return false;
  const text = getTextRecord(doc, id);
  if (!text) return false;

  const canWiden = widen === true && text.get('widthMode') !== 'fixed';
  const changed: Array<'width' | 'height'> = [];
  if (needed.height > Number(text.get('height') ?? 0)) changed.push('height');
  if (canWiden && needed.width > Number(text.get('width') ?? 0)) changed.push('width');
  if (changed.length === 0) return false;

  doc.transact(() => {
    for (const key of changed) text.set(key, needed[key]);
  }, BOX_ORIGIN);
  return true;
}

/** True when the object holds no characters. Whitespace counts as content (TC-04). */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const text = getTextContent(doc, id);
  if (!text) return true; // nothing there holds nothing
  return text.length === 0;
}

/**
 * Removes the object when it is empty (PRD text.empty_removed), so an abandoned text never
 * stays on the board as an invisible target. False when it has characters or is not there.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  const objects = objectsOf(doc);
  if (!getTextRecord(doc, id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Reads one `Y.Map` into a `TextSnapshot`, or `undefined` when it is malformed (a text object
 * this build cannot place or draw is skipped rather than crashing the board).
 */
export function readTextObject(id: string, raw: Y.Map<unknown>): TextSnapshot | undefined {
  const x = raw.get('x');
  const y = raw.get('y');
  const z = raw.get('z');
  const width = raw.get('width');
  const height = raw.get('height');
  const size = raw.get('size');
  if (!finite(x) || !finite(y) || !finite(z)) return undefined;
  if (!finite(width) || !finite(height)) return undefined;
  if (!isTextSize(size)) return undefined;

  const text = raw.get('text');
  const createdAt = raw.get('createdAt');
  const createdBy = raw.get('createdBy');
  const widthMode = raw.get('widthMode');
  return Object.freeze({
    id,
    type: 'text' as const,
    x,
    y,
    width,
    height,
    z,
    createdAt: finite(createdAt) ? createdAt : 0,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    text: text instanceof Y.Text ? text.toString() : typeof text === 'string' ? text : '',
    size,
    widthMode: widthMode === 'fixed' ? ('fixed' as const) : ('auto' as const),
  });
}
