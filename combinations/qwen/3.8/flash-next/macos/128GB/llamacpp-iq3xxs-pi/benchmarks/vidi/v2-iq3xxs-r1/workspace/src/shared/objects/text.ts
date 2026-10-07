import * as Y from 'yjs';
import {
  deleteObjects,
  LOCAL_ORIGIN,
  OBJECTS_MAP,
  type ObjectSnapshot,
  type WorldPoint,
} from '../board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../config';

// ---------------------------------------------------------------------------
// The free text object (story 9): plain text with no background, placed anywhere
// on the board. It lives in the same `objects` map as sticky notes and reuses
// story 7's generic select/move/delete and story 8's undo unchanged (PRD
// text.consistent) — there is deliberately no text-specific selection code here.
//
// Stored schema (`objects/<id>`):
//   type: 'text', x, y, width, height, z, createdAt, createdBy,
//   text: Y.Text, size: 'S'|'M'|'L'|'XL', widthMode: 'auto' | 'fixed'
//
// `width`/`height` are *stored* rather than re-measured by every client: the one
// client that made a local change measures and writes the box, the others render
// it (design key decision 1).
// ---------------------------------------------------------------------------

/**
 * Whether the width is whatever the text needs (capped) or whatever the person
 * dragged it to (PRD text.auto_width, text.fixed_width).
 */
export type TextWidthMode = 'auto' | 'fixed';

export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: TextWidthMode;
  /** Every text object carries its box: it is what the renderer draws. */
  width: number;
  height: number;
  /** The tab that created it (PRD text.create). */
  createdBy: string;
}

type AnyMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<AnyMap> {
  return doc.getMap<AnyMap>(OBJECTS_MAP);
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The Y.Map of a text object, or undefined for a stale id or another type. */
function textMap(doc: Y.Doc, id: string): AnyMap | undefined {
  const m = objectsOf(doc).get(id);
  if (!(m instanceof Y.Map)) return undefined;
  if (m.get('type') !== 'text') return undefined;
  return m;
}

/** Highest `z` of *any* object, so a new text lands above stickies too. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of objectsOf(doc).values()) {
    if (m instanceof Y.Map) max = Math.max(max, asFiniteNumber(m.get('z')));
  }
  return max;
}

/** A text object's size preset, or the default when the stored value is odd. */
function readSize(value: unknown): TextSize {
  return typeof value === 'string' && value in TEXT_SIZES
    ? (value as TextSize)
    : DEFAULT_TEXT_SIZE;
}

function readText(id: string, m: AnyMap): TextSnapshot {
  const raw = m.get('text');
  const mode = m.get('widthMode');
  const createdBy = m.get('createdBy');
  return {
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    id,
    type: 'text',
    x: asFiniteNumber(m.get('x')),
    y: asFiniteNumber(m.get('y')),
    z: asFiniteNumber(m.get('z')),
    width: asFiniteNumber(m.get('width'), TEXT_MIN_WIDTH_WORLD),
    height: asFiniteNumber(m.get('height')),
    text: raw instanceof Y.Text ? raw.toString() : typeof raw === 'string' ? raw : '',
    size: readSize(m.get('size')),
    widthMode: mode === 'fixed' ? 'fixed' : 'auto',
  };
}

/**
 * Every text object in paint order (ascending `(z, id)`), so equal `z` values
 * from concurrent creates render identically on every client. Sticky notes and
 * unknown object kinds are left to `board-model`'s own snapshot.
 */
export function textSnapshots(doc: Y.Doc): readonly TextSnapshot[] {
  const out: TextSnapshot[] = [];
  for (const [id, m] of objectsOf(doc)) {
    if (!(m instanceof Y.Map)) continue;
    if (m.get('type') !== 'text') continue;
    out.push(readText(id, m));
  }
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Create a text object with its **top-left** at `at` (PRD text.create), size M,
 * automatic width, empty content, and `z` above every other object — all in one
 * local transaction.
 *
 * The box starts as an estimate for one empty line so selection bounds and the
 * marquee are finite before the first measure. Returns the new id, or `null` for
 * a non-finite point, in which case nothing is written.
 */
export function createText(
  doc: Y.Doc,
  at: WorldPoint,
  createdBy: string,
): string | null {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;

  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;
  const createdAt = Date.now();
  const size = DEFAULT_TEXT_SIZE;
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'text');
    m.set('x', at.x);
    m.set('y', at.y);
    // An estimate of an empty line: the real box follows the first measure.
    m.set('width', TEXT_MIN_WIDTH_WORLD);
    m.set('height', Math.round(TEXT_SIZES[size] * TEXT_LINE_HEIGHT));
    m.set('z', z);
    m.set('createdAt', createdAt);
    m.set('createdBy', typeof createdBy === 'string' ? createdBy : '');
    m.set('text', new Y.Text(''));
    m.set('size', size);
    m.set('widthMode', 'auto');
    objectsOf(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Change the text size to one of the presets (PRD text.size). Position is never
 * touched, so the top-left stays put; the caller re-measures the box afterwards.
 * False — and no write — for a stale id or an unknown size key.
 */
export function setTextSize(doc: Y.Doc, id: string, size: string): boolean {
  if (typeof size !== 'string' || !(size in TEXT_SIZES)) return false;
  const m = textMap(doc, id);
  if (!m) return false;
  if (m.get('size') === size) return false; // already that size: no update at all
  doc.transact(() => m.set('size', size), LOCAL_ORIGIN);
  return true;
}

/**
 * A side handle was dragged: from now on the width is fixed at `width`, never
 * smaller than TEXT_MIN_WIDTH_WORLD (PRD text.fixed_width). The height always
 * follows the content, so it is left to the re-measure that follows.
 * False — and no write — for a stale id or a non-finite width.
 */
export function setTextWidthFixed(doc: Y.Doc, id: string, width: number): boolean {
  if (!Number.isFinite(width)) return false;
  const m = textMap(doc, id);
  if (!m) return false;
  const next = Math.max(width, TEXT_MIN_WIDTH_WORLD);
  if (m.get('widthMode') === 'fixed' && m.get('width') === next) return false;
  doc.transact(() => {
    m.set('widthMode', 'fixed');
    m.set('width', next);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Store the measured box (design key decision 1: the client that changed the
 * text writes it, everybody else renders it). False — and no write — for a stale
 * id, a non-finite or non-positive number, or a box that is already exactly this.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!box || !Number.isFinite(box.width) || !Number.isFinite(box.height)) return false;
  if (box.width <= 0 || box.height <= 0) return false;
  const m = textMap(doc, id);
  if (!m) return false;
  if (m.get('width') === box.width && m.get('height') === box.height) return false;
  doc.transact(() => {
    m.set('width', box.width);
    m.set('height', box.height);
  }, LOCAL_ORIGIN);
  return true;
}

/** The shared `Y.Text` of a text object, for minimal-diff editing (story 3). */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = textMap(doc, id);
  if (!m) return undefined;
  const text = m.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * True when the object holds no characters at all. Whitespace-only text was typed
 * on purpose and is kept (design decision: only zero characters counts as empty).
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id);
  return ytext ? ytext.toString().length === 0 : false;
}

/**
 * Remove a text object that ended up empty (PRD text.empty_removed), so no
 * invisible object is ever left on the board. False when it holds characters or
 * the id is stale.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  return deleteObjects(doc, [id]) === 1;
}
