import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE, DEFAULT_STICKY_COLOR, DEFAULT_TEXT_SIZE, SHAPE_FILL_COLORS, SHAPE_KINDS,
  SHAPE_STROKE_COLORS, STICKY_COLORS, STICKY_SIZE_WORLD, TEXT_SIZES,
  type FillColor, type StickyColor, type StrokeColor, type TextSize,
} from './config';
import { rectContains, type Point, type Rect } from './geometry';
import { connectorBBox, resolveEndpoints, type Endpoint } from './geometry/connector-geometry';
import { detachConnectorsTo } from './objects/connector';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');

export const SCHEMA_VERSION = 1;
const HALF = 2;

/** Object types that can be selected, moved and resized. Stories 9–12 add theirs here and in the registry. */
const SELECTABLE_TYPES = new Set<string>(['sticky', 'shape', 'connector']);

/** Called by the client's object registry so objects of the new type appear in snapshots and selections. */
export function registerSelectableType(type: string): void {
  SELECTABLE_TYPES.add(type);
}

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  width: number;
  height: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
}

export interface TextSnapshot {
  /** Text has no colour; declared so code reading either kind of object can ask for it. */
  color?: undefined;
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
  z: number;
  createdAt: number;
}

export type ShapeKind = typeof SHAPE_KINDS[number];

export interface ShapeSnapshot {
  color?: undefined;
  text?: undefined;
  id: string;
  type: 'shape';
  kind: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
  z: number;
  createdAt: number;
}

export interface ConnectorSnapshot {
  color?: undefined;
  text?: undefined;
  id: string;
  type: 'connector';
  /** The bounding box of the resolved line; derived on every snapshot, never stored. */
  x: number;
  y: number;
  width: number;
  height: number;
  from: Endpoint;
  to: Endpoint;
  /** Where the line starts and ends now (attached ends resolved to their object's nearest side). */
  start: Point;
  end: Point;
  z: number;
  createdAt: number;
}

/** Every board object; later stories widen this union. */
export type ObjectSnapshot = StickySnapshot | TextSnapshot | ShapeSnapshot | ConnectorSnapshot;

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function isColor(c: unknown): c is StickyColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, c);
}

function zOf(m: Y.Map<unknown>): number {
  const z = m.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsOf(doc).forEach((m) => { max = Math.max(max, zOf(m)); });
  return max;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
  }
  doc.getMap('objects');
}

/** Creates a note centred on `at`. Returns false (no change) for non-finite coordinates. */
export function createSticky(
  doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !isColor(color)) return false;
  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    objectsOf(doc).set(id, m);
    m.set('type', 'sticky');
    m.set('x', at.x - STICKY_SIZE_WORLD / HALF);
    m.set('y', at.y - STICKY_SIZE_WORLD / HALF);
    m.set('width', STICKY_SIZE_WORLD);
    m.set('height', STICKY_SIZE_WORLD);
    m.set('color', color);
    m.set('text', new Y.Text());
    m.set('z', z);
    m.set('createdAt', Date.now());
  }, LOCAL_ORIGIN);
  return id;
}

function getObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsOf(doc).get(id);
  return m instanceof Y.Map ? m : undefined;
}

const finite = (...values: number[]) => values.every((v) => Number.isFinite(v));

/**
 * Sets absolute positions. Non-finite values reject the whole call (0, no transaction); missing ids
 * are skipped. Returns the number of objects that changed, in one transaction.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  const changes: [Y.Map<unknown>, Point][] = [];
  const moves: [string, Point][] = [];
  for (const [id, p] of positions) {
    if (!finite(p.x, p.y)) return 0;
    const m = getObject(doc, id);
    if (m?.get('type') === 'connector') {
      moves.push([id, p]);
    } else if (m && (m.get('x') !== p.x || m.get('y') !== p.y)) {
      changes.push([m, p]);
    }
  }
  const connectorMoves = moves.length > 0 ? connectorShifts(doc, moves) : [];
  if (changes.length === 0 && connectorMoves.length === 0) return 0;
  doc.transact(() => {
    for (const [m, p] of changes) {
      m.set('x', p.x);
      m.set('y', p.y);
    }
    for (const apply of connectorMoves) apply();
  }, LOCAL_ORIGIN);
  return changes.length + connectorMoves.length;
}

/**
 * Arrows move by their free ends: only an arrow whose ends are both free follows a move (an attached end
 * stays tied to its object), so the wanted top-left of its bounding box is reachable.
 */
function connectorShifts(doc: Y.Doc, moves: readonly [string, Point][]): (() => void)[] {
  const out: (() => void)[] = [];
  const all = snapshot(doc);
  for (const [id, p] of moves) {
    const c = all.find((o) => o.id === id);
    const m = getObject(doc, id);
    if (!m || c?.type !== 'connector' || c.from.kind !== 'free' || c.to.kind !== 'free') continue;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    if (dx === 0 && dy === 0) continue;
    const { from, to } = c;
    out.push(() => {
      m.set('from', { kind: 'free', x: from.x + dx, y: from.y + dy });
      m.set('to', { kind: 'free', x: to.x + dx, y: to.y + dy });
    });
  }
  return out;
}

/** Sets absolute rects (position and size; the first resize of an implicit-size note makes it explicit). */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  const changes: [Y.Map<unknown>, Rect][] = [];
  for (const [id, r] of rects) {
    if (!finite(r.x, r.y, r.width, r.height) || r.width <= 0 || r.height <= 0) return 0;
    const m = getObject(doc, id);
    if (m?.get('type') === 'connector') continue; // arrows are not resizable
    if (m && (m.get('x') !== r.x || m.get('y') !== r.y || m.get('width') !== r.width || m.get('height') !== r.height)) {
      changes.push([m, r]);
    }
  }
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const [m, r] of changes) {
      m.set('x', r.x);
      m.set('y', r.y);
      m.set('width', r.width);
      m.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return changes.length;
}

/**
 * Raises `ids` above every unselected object, keeping their order among themselves
 * (z = highest unselected z + rank). Returns how many z values were written.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const wanted = new Set(ids);
  const all = snapshot(doc);
  const selected = all.filter((o) => wanted.has(o.id));
  if (selected.length === 0) return 0;
  let maxUnselected = 0;
  for (const o of all) if (!wanted.has(o.id)) maxUnselected = Math.max(maxUnselected, o.z);
  if (selected.every((o) => o.z > maxUnselected)) return 0;
  doc.transact(() => {
    selected.forEach((o, rank) => getObject(doc, o.id)?.set('z', maxUnselected + 1 + rank));
  }, LOCAL_ORIGIN);
  return selected.length;
}

export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const present = ids.filter((id) => getObject(doc, id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    detachConnectorsTo(doc, present);
    present.forEach((id) => objectsOf(doc).delete(id));
  }, LOCAL_ORIGIN);
  return present.length;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const m = getObject(doc, id);
  if (!m || !isColor(color)) return false;
  if (m.get('color') === color) return false;
  doc.transact(() => m.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = getObject(doc, id);
  if (!m || m.get('type') !== 'sticky') return undefined;
  const t = m.get('text');
  return t instanceof Y.Text ? t : undefined;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Notes created before objects had a size have none stored and keep the original size. */
function size(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : STICKY_SIZE_WORLD;
}

export function objectBounds(obj: ObjectSnapshot): Rect {
  if (obj.type === 'connector') return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  const fallback = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : STICKY_SIZE_WORLD);
  return { x: obj.x, y: obj.y, width: fallback(obj.width), height: fallback(obj.height) };
}

/** Ids of objects lying entirely inside `rect` (partly inside or merely touching from outside: no). */
export function objectsInRect(snap: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snap.filter((o) => SELECTABLE_TYPES.has(o.type) && rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/** Every selectable object; objects of unknown type are left out. */
export function allObjectIds(snap: readonly ObjectSnapshot[]): string[] {
  return snap.filter((o) => SELECTABLE_TYPES.has(o.type)).map((o) => o.id);
}

function endpointOf(v: unknown, fallback: Endpoint): Endpoint {
  const e = v as Record<string, unknown> | null | undefined;
  if (e && e.kind === 'attached' && typeof e.objectId === 'string') {
    const f = e.fallback as Record<string, unknown> | undefined;
    return { kind: 'attached', objectId: e.objectId, fallback: { x: num(f?.x), y: num(f?.y) } };
  }
  if (e && e.kind === 'free') return { kind: 'free', x: num(e.x), y: num(e.y) };
  return fallback;
}

const hasKey = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

/** All objects of registered types sorted by (z, id); objects of unknown type are skipped. */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  const connectors: [string, Y.Map<unknown>][] = [];
  objectsOf(doc).forEach((m, id) => {
    const type = m instanceof Y.Map ? m.get('type') : undefined;
    if (!(m instanceof Y.Map) || typeof type !== 'string' || !SELECTABLE_TYPES.has(type)) return;
    const color = m.get('color');
    const text = m.get('text');
    if (type === 'connector') {
      connectors.push([id, m]);
      return;
    }
    if (type === 'shape') {
      const kind = m.get('kind');
      const fill = m.get('fill');
      const stroke = m.get('stroke');
      const label = m.get('label');
      out.push({
        id,
        type: 'shape',
        kind: SHAPE_KINDS.includes(kind as ShapeKind) ? (kind as ShapeKind) : 'rect',
        x: num(m.get('x')),
        y: num(m.get('y')),
        width: size(m.get('width')),
        height: size(m.get('height')),
        fill: hasKey(SHAPE_FILL_COLORS, fill) ? (fill as FillColor) : DEFAULT_SHAPE_FILL,
        stroke: hasKey(SHAPE_STROKE_COLORS, stroke) ? (stroke as StrokeColor) : DEFAULT_SHAPE_STROKE,
        label: label instanceof Y.Text ? label.toString() : '',
        z: zOf(m),
        createdAt: num(m.get('createdAt')),
      });
      return;
    }
    if (type === 'text') {
      const sz = m.get('size');
      out.push({
        id,
        type: 'text',
        x: num(m.get('x')),
        y: num(m.get('y')),
        width: size(m.get('width')),
        height: size(m.get('height')),
        text: text instanceof Y.Text ? text.toString() : '',
        size: typeof sz === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, sz) ? (sz as TextSize) : DEFAULT_TEXT_SIZE,
        widthMode: m.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
        z: zOf(m),
        createdAt: num(m.get('createdAt')),
      });
      return;
    }
    out.push({
      id,
      type: type as 'sticky',
      x: num(m.get('x')),
      y: num(m.get('y')),
      width: size(m.get('width')),
      height: size(m.get('height')),
      color: isColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: zOf(m),
      createdAt: num(m.get('createdAt')),
    });
  });
  if (connectors.length > 0) {
    const rects = new Map<string, Rect>();
    for (const o of out) rects.set(o.id, objectBounds(o));
    for (const [id, m] of connectors) {
      const from = endpointOf(m.get('from'), { kind: 'free', x: 0, y: 0 });
      const to = endpointOf(m.get('to'), { kind: 'free', x: 0, y: 0 });
      const ends = resolveEndpoints({ from, to }, rects);
      const box = connectorBBox(ends.from, ends.to);
      out.push({ id, type: 'connector', ...box, from, to, start: ends.from, end: ends.to, z: zOf(m), createdAt: num(m.get('createdAt')) });
    }
  }
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
