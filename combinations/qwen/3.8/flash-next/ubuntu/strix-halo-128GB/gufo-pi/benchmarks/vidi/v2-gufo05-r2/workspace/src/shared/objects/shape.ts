/**
 * Story 10: the shape object — its stored fields, and the model calls that make
 * and restyle one.
 *
 * A shape is a rect, an ellipse or a diamond with an optional short label. Like a
 * sticky note its text lives in its own Y.Text so two people can type in two shapes
 * at once, and like every object its box is stored rather than derived — the tool
 * that drew it decided how big it is, and nothing about a shape depends on this
 * client's fonts.
 *
 * A document written before story 10 simply has no `shape` entries in it: nothing
 * here has to migrate, and a shape entry that a broken client filled in with
 * rubbish falls back to the defaults rather than drawing a shape no one can move.
 */

import * as Y from 'yjs';

import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from '../config';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import { normalizeRect, type Rect } from '../geometry';

export type { ShapeKind };

/** What a shape stores on top of the common fields. */
export interface ShapeSnapshot extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

const KIND_SET: ReadonlySet<string> = new Set<string>(SHAPE_KINDS);

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

/** The text of a stored `Y.Text`, or nothing when the entry has none. */
function readText(value: unknown): string {
  return value instanceof Y.Text ? value.toString() : '';
}

function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && KIND_SET.has(value);
}

export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_FILL_COLORS, value);
}

export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_STROKE_COLORS, value);
}

/** The label of a shape, as the shared string that holds it. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = objectsMap(doc).get(id);
  const text = entry?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * The box a create request means: the dragged box when it is big enough to be a
 * deliberate box, and the default box centred on the press point when it is not —
 * which is what makes a click, or a flick smaller than the threshold, still place a
 * shape a person can see and grab.
 */
export function shapeBoxOf(
  rect: Rect | null,
  at: { x: number; y: number },
  square: boolean,
): Rect {
  if (!rect) return defaultShapeBox(at);
  const box = normalizeRect({ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height });
  if (box.width < SHAPE_MIN_SIZE_WORLD || box.height < SHAPE_MIN_SIZE_WORLD) {
    return defaultShapeBox(at);
  }
  if (!square) return box;
  // A square keeps the larger of the two dragged dimensions and grows the other
  // one, held at the corner the drag started from — so shifting mid-drag squares
  // the shape off the same corner instead of sliding it about.
  const side = Math.max(box.width, box.height);
  const x = at.x <= box.x + box.width / 2 ? box.x : box.x + box.width - side;
  const y = at.y <= box.y + box.height / 2 ? box.y : box.y + box.height - side;
  return { x, y, width: side, height: side };
}

/** The standard shape: `SHAPE_DEFAULT_SIZE_WORLD` on a side, centred on a point. */
export function defaultShapeBox(at: { x: number; y: number }): Rect {
  return {
    x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
    y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    width: SHAPE_DEFAULT_SIZE_WORLD,
    height: SHAPE_DEFAULT_SIZE_WORLD,
  };
}

/**
 * Draw a shape.
 *
 * `rect` is the box the pointer dragged out, or null for a click; `at` is where the
 * pointer went down, used for the default box and as the anchor of a square;
 * `square` is the Shift key held while dragging. Returns the new shape's id, or null
 * when the request is not sound — an unknown kind, or a press point that is not a
 * place — in which case the document is untouched.
 */
export function createShape(
  doc: Y.Doc,
  input: { kind: string; rect: Rect | null; at: { x: number; y: number }; square: boolean },
  by: string,
  now = Date.now(),
): string | null {
  if (!isShapeKind(input.kind)) return null;
  if (!Number.isFinite(input.at?.x) || !Number.isFinite(input.at?.y)) return null;
  if (input.rect) {
    if (!Number.isFinite(input.rect.x) || !Number.isFinite(input.rect.y)) return null;
    if (!Number.isFinite(input.rect.width) || !Number.isFinite(input.rect.height)) return null;
  }
  const box = shapeBoxOf(input.rect, input.at, input.square);
  const id = crypto.randomUUID();
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', 'shape');
    entry.set('x', box.x);
    entry.set('y', box.y);
    entry.set('width', box.width);
    entry.set('height', box.height);
    entry.set('z', maxZ(objectsMap(doc)) + 1);
    entry.set('createdAt', now);
    entry.set('createdBy', by);
    entry.set('kind', input.kind);
    entry.set('fill', DEFAULT_SHAPE_FILL);
    entry.set('stroke', DEFAULT_SHAPE_STROKE);
    entry.set('text', new Y.Text());
    objectsMap(doc).set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Give a shape a fill or an outline from the palettes.
 *
 * False when the object is gone, is not a shape, or names a colour that is not on
 * the palette — the document never holds a colour the board cannot draw.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  style: { fill?: unknown; stroke?: unknown },
): boolean {
  if (style.fill === undefined && style.stroke === undefined) return false;
  if (style.fill !== undefined && !isFillColor(style.fill)) return false;
  if (style.stroke !== undefined && !isStrokeColor(style.stroke)) return false;
  const entry = objectsMap(doc).get(id);
  if (!entry || entry.get('type') !== 'shape') return false;
  doc.transact(() => {
    if (style.fill !== undefined) entry.set('fill', style.fill);
    if (style.stroke !== undefined) entry.set('stroke', style.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Cut a label to the length a shape holds (PRD shape.label_limit). Somebody typing
 * past it is stopped here, in the editor, so the extra characters never reach the
 * document in the first place.
 */
export function clampShapeLabel(text: string): string {
  return text.length > SHAPE_LABEL_MAX_CHARS ? text.slice(0, SHAPE_LABEL_MAX_CHARS) : text;
}

/**
 * How a label is drawn. Text that arrived over the limit — written by a client that
 * does not know it — is shown cut short with an ellipsis, rather than overflowing the
 * shape or hiding the first 500 characters.
 */
export function shapeLabelDisplay(label: string): string {
  return label.length > SHAPE_LABEL_MAX_CHARS
    ? `${label.slice(0, SHAPE_LABEL_MAX_CHARS)}…`
    : label;
}

/** Narrow a snapshot read from the board back to a shape. */
export function isShapeSnapshot(obj: ObjectSnapshot): obj is ShapeSnapshot {
  return obj.type === 'shape';
}

/** Read one stored shape, or null when the id is gone or is not a shape. */
export function readShape(doc: Y.Doc, id: string): ShapeSnapshot | null {
  const entry = objectsMap(doc).get(id);
  if (!entry || entry.get('type') !== 'shape') return null;
  return shapeSnapshotOf(id, entry);
}

/** Every shape on the board, in the order the document lists them. */
export function readShapes(doc: Y.Doc): ShapeSnapshot[] {
  const out: ShapeSnapshot[] = [];
  for (const [id, entry] of objectsMap(doc)) {
    if (entry.get('type') === 'shape') out.push(shapeSnapshotOf(id, entry));
  }
  return out;
}

/** The shape fields of a stored entry, with defaults for anything missing. */
export function shapeSnapshotOf(id: string, entry: Y.Map<unknown>): ShapeSnapshot {
  const kind = entry.get('kind');
  const fill = entry.get('fill');
  const stroke = entry.get('stroke');
  return {
    id,
    type: 'shape',
    x: num(entry.get('x')),
    y: num(entry.get('y')),
    width: num(entry.get('width')),
    height: num(entry.get('height')),
    z: num(entry.get('z')),
    createdBy: typeof entry.get('createdBy') === 'string' ? (entry.get('createdBy') as string) : undefined,
    createdAt: num(entry.get('createdAt')),
    kind: isShapeKind(kind) ? kind : 'rect',
    fill: isFillColor(fill) ? fill : DEFAULT_SHAPE_FILL,
    stroke: isStrokeColor(stroke) ? stroke : DEFAULT_SHAPE_STROKE,
    label: readText(entry.get('text')),
  };
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const entry of objects.values()) {
    const z = entry.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
