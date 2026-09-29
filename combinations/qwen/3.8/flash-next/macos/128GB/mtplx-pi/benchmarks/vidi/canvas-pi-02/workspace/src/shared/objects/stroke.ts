/**
 * Stroke object model (story 11).
 *
 * Schema:
 * ```
 * objects/<id>: Y.Map {
 *   type: 'stroke'
 *   x, y: number           // top-left of the ink's bounding box, world units
 *   width, height: number  // the same box, kept so the generic move/resize
 *                          // path works without knowing what a stroke is
 *   points: number[]       // [x0,y0,x1,y1,…], relative to (x, y), world units
 *   baseWidth, baseHeight: number   // the box's own size, for a reconstruction
 *   color: PenColor        // the name, not the hex: a late joiner must be
 *                          // able to repair an unknown colour
 *   thickness: PenThickness
 *   closed: boolean
 *   z, createdAt, createdBy
 * }
 * ```
 *
 * Three things this file insists on, all of them from design §2:
 *
 *   - **No derived state is stored.** No `d`, no `hitBBox`, no `hitPath`, no
 *     rendered flag. What is stored is the *fact* (a capture, its geometry, and
 *     a style); everything else is computed, by `buildStrokeRender`/`strokeHit`
 *     below, and the DOM reflects it.
 *   - **The geometry is relative and raw.** A stroke is not a shape and does
 *     not own a box, so the renderer never depends on a box the object also
 *     carries, and a resize rescales the points instead of scaling a path that
 *     was built from the old ones.
 *   - **What is drawn and what is hit come from one function**
 *     (`strokeGeometry`), so a click that looks like it is on the ink has to
 *     land on it.
 */
import * as Y from 'yjs';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../config';
import type { Point, Rect } from '../geometry';
import { LOCAL_ORIGIN, objectsMap } from '../board-model';
import { simplify } from '../geometry/simplify';
import { segmentStroke, strokeSelfIntersection } from '../geometry/stroke-path';

/** Stroke snapshot: what `snapshot()` hands to React for one drawing. */
export interface StrokeSnap {
  id: string;
  type: 'stroke';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy: string;
  /** Flattened ink, relative to (x, y): `[x0, y0, x1, y1, …]`. */
  points: number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  closed: boolean;
}

/** How the ink is produced: the capture itself, or a reconstruction of it. */
export type StrokeSource = 'replay' | 'reconstruct';

/** The drawing of one stroke, in canvas coordinates. */
export interface StrokeRender {
  /** Which branch of §4.3 this is; also `data-stroke-kind`. */
  kind: 'polyline' | 'path';
  /** The path data, built by exactly one function. */
  d: string;
  /** Canvas-relative bounding box of the ink (no padding). */
  bbox: Rect;
  /**
   * Whether this stroke draws its own closing chord. False on the replay
   * branch (no chord to draw: the capture came back); true on a reconstruction
   * and on a closed path, where the chord *is* the last segment.
   */
  closesChord: boolean;
  /** The geometry is a ring, whatever is drawn. */
  ring: boolean;
  /** The skeleton crosses itself somewhere. */
  selfCrossed: boolean;
}

/** The area a stroke answers to a click in, in canvas coordinates. */
export interface StrokeHit {
  /** Canvas-relative, padding included, so the selection frame fits it. */
  bbox: Rect;
  /** Cheaper than `bbox` when all you have is a point. */
  contains(x: number, y: number): boolean;
}

/** Half the ink width plus the tolerance, in world units. */
export const STROKE_HIT_PADDING_WORLD = STROKE_HIT_TOLERANCE_PX;

const round = (value: number): number => Math.round(value * 100) / 100;

/** True for our own type. */
export function isStrokeType(type: string): boolean {
  return type === 'stroke';
}

/** The stored style of a snapshot, repaired the same way a record is. */
export function strokeStyle(snap: { color: string; thickness: string }): {
  color: PenColor;
  thickness: PenThickness;
} {
  return {
    color: snap.color in PEN_COLORS ? (snap.color as PenColor) : DEFAULT_PEN_COLOR,
    thickness:
      snap.thickness in PEN_THICKNESS_WORLD
        ? (snap.thickness as PenThickness)
        : DEFAULT_PEN_THICKNESS,
  };
}

/** The visual width of a thickness, in world units (design §4.2). */
export function strokeWidthWorld(thickness: PenThickness): number {
  return PEN_THICKNESS_WORLD[thickness] ?? PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS];
}

/**
 * The width of the hit envelope (design §4.2): the ink, or one screen pixel
 * and a half, whichever is wider. Two `distanceToPolyline` layers over
 * anything narrower than a hair would buy a margin nobody can see and a
 * second hit shape to keep in sync.
 */
export function strokeHitWidthWorld(thickness: PenThickness): number {
  return Math.max(strokeWidthWorld(thickness), STROKE_HIT_TOLERANCE_PX);
}

/** Flatten `[x, y, …]` into points. Non-finite pairs are dropped. */
export function toPoints(flat: readonly number[]): Point[] {
  const points: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = flat[i]!;
    const y = flat[i + 1]!;
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  return points;
}

/** Un-flatten points back into the stored array. */
export function toFlat(points: readonly Point[]): number[] {
  const flat: number[] = [];
  for (const point of points) {
    flat.push(round(point.x), round(point.y));
  }
  return flat;
}

/** The ink's own bounding box, relative to the stroke's position. */
export function strokeBBox(points: readonly Point[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The stored geometry, already simplified, relative. (3.3) */
export function strokePoints(snap: Pick<StrokeSnap, 'points'>): Point[] {
  return toPoints(snap.points);
}

/** The centreline actually drawn: the points, closed when the stroke is. */
export function strokeSkeleton(snap: StrokeSnap): Point[] {
  return strokeGeometry(snap).skeleton;
}

/**
 * One geometry, two widths (design §3.3, decision 1).
 *
 * The *render* half is the skeleton drawn `strokeWidth` wide; the *hit* half is
 * the same skeleton, `hitWidth` wide. Both come from `strokeGeometry`, which is
 * the only reason they can be relied on to agree.
 */
export function strokeGeometry(snap: StrokeSnap): {
  skeleton: Point[];
  renderWidth: number;
  hitWidth: number;
  selfCrossed: Point | null;
} {
  const style = strokeStyle(snap);
  const points = simplify(toPoints(snap.points), STROKE_SIMPLIFY_TOLERANCE_PX);
  const geometry = segmentStroke(
    points,
    strokeHitWidthWorld(style.thickness),
    snap.closed === true,
  );
  return {
    skeleton: geometry.skeleton,
    renderWidth: strokeWidthWorld(style.thickness),
    hitWidth: strokeHitWidthWorld(style.thickness),
    selfCrossed: strokeSelfIntersection(points),
  };
}

/** Whether the geometry is a ring: 3+ points and the last is near the first. */
export function strokeIsRing(snap: Pick<StrokeSnap, 'points' | 'closed'>): boolean {
  const points = toPoints(snap.points);
  if (points.length < 3) return false;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const anchor = points[points.length - 2]!;
  const chord = Math.hypot(first.x - anchor.x, first.y - anchor.y);
  if (!(chord > 0)) return false;
  const gap = Math.hypot(first.x - last.x, first.y - last.y);
  return gap / chord < 0.02;
}

/**
 * Whether the ring is round, which is the one thing that tells a replay from a
 * reconstruction.
 *
 * True for any closed capture whose closing chord is shorter than the `lineTo`
 * a reconstruction would draw instead — which includes deliberately
 * straight-sided rings, and accepting that is design §4.4 / risk 4. The error
 * is under 1.41 world units at any zoom, and the alternative — a second stored
 * truth that has to agree with the capture — is what breaks when the two
 * drift.
 */
export function strokeIsDisc(snap: Pick<StrokeSnap, 'points' | 'closed'>): boolean {
  if (snap.closed !== true) return false;
  const points = toPoints(snap.points);
  if (points.length < 3) return false;
  const first = points[0]!;
  const anchor = points[points.length - 2]!;
  const chord = Math.hypot(first.x - anchor.x, first.y - anchor.y);
  return chord <= 2 * STROKE_SIMPLIFY_TOLERANCE_PX;
}

/** Whether the skeleton crosses itself. */
export function strokeSelfCross(snap: Pick<StrokeSnap, 'points'>): boolean {
  return strokeSelfIntersection(toPoints(snap.points)) !== null;
}

/** Whether the last segment would be a chord (true for a polyline stroke). */
export function strokeClosesChord(snap: StrokeSnap): boolean {
  return buildStrokeRender(snap).closesChord;
}

/**
 * The one truth about how a stroke is drawn (design §4.3).
 *
 * A circle goes back exactly as it came; anything else closed gets the chord it
 * is missing. Both branches come from this function, and no rendering path may
 * build path data anywhere else — including the preview layer, which calls
 * *this* function on a stroke it has already built.
 */
export function buildStrokeRender(snap: StrokeSnap): StrokeRender {
  const ring = snap.closed === true;
  const replay = !strokeReconstruct(snap);
  const disc = replay && strokeIsDisc(snap);
  // The drawn line is the whole capture, unprojected (§4.3): every point,
  // because dropping one is what turns a scribbled circle into a polygon. The
  // *hit* envelope may be built from the simplified skeleton, because an area
  // nobody can see the difference in is not a drawing; a path is.
  const points = toPoints(snap.points);

  let d: string;
  let closesChord: boolean;
  if (points.length === 1) {
    // One point is a dot: the pen touched the glass and did not move. A lone `M`
    // paints nothing at all — a subpath has to draw somewhere before a line cap
    // exists — so the dot is a segment of no length, which the round cap fills
    // into a dot as wide as the pen (§4.5, `pen.dot`).
    const only = points[0]!;
    d = `M${round(only.x)},${round(only.y)} L${round(only.x)},${round(only.y)}`;
    closesChord = false;
  } else if (disc) {
    // Replay of a ring: the closing chord is part of the capture, so it is
    // drawn as a `Z` on the path — not as a `lineTo` on a polyline.
    d = `M${points.map((point) => `${round(point.x)},${round(point.y)}`).join(' L')} Z`;
    closesChord = false;
  } else if (ring) {
    // Either a reconstruction, or a capture whose closing chord is a line
    // someone drew: in both cases the chord is drawn as a segment.
    d = `M${points.map((point) => `${round(point.x)},${round(point.y)}`).join(' L')}`;
    if (ring) d += ' Z';
    closesChord = true;
  } else {
    d = `M${points.map((point) => `${round(point.x)},${round(point.y)}`).join(' L')}`;
    closesChord = false;
  }

  return {
    kind: disc ? 'path' : 'polyline',
    d,
    bbox: strokeBBox(points),
    closesChord,
    ring,
    selfCrossed: strokeSelfIntersection(points) !== null,
  };
}

/** The `d` a stroke is drawn with, without the box around it. */
export function strokePathData(snap: StrokeSnap): string {
  return buildStrokeRender(snap).d;
}

/** Which branch this stroke is on. */
export function strokeReconstruct(snap: Pick<StrokeSnap, 'points' | 'closed'>): boolean {
  return snap.closed === true && !strokeIsDisc(snap);
}

/**
 * The hit area: one envelope, computed from the same geometry that is drawn
 * (design §3.3). Cached per snapshot object *and* zoom, because the snapshot
 * array is rebuilt on every document change and a board of five hundred strokes
 * must not rebuild five hundred envelopes to answer one click.
 */
/** The hit area, plus the zoom it was measured at. */
export interface StrokeHitWithZoom extends StrokeHit {
  zoom: number;
}

const HIT_CACHE = new WeakMap<object, StrokeHitWithZoom>();

export function strokeHit(snap: StrokeSnap, zoom = 1): StrokeHitWithZoom {
  const cached = HIT_CACHE.get(snap);
  if (cached && cached.zoom === zoom) return cached;
  const style = strokeStyle(snap);
  // The envelope is at least `STROKE_HIT_TOLERANCE_PX` screen pixels wide *at the
  // zoom the click happens at*, which is the part of `pen.select` a fixed world
  // width cannot express: 6 world units is twelve screen pixels at 50% and three
  // at 200%. And it is never thinner than the ink itself, so a thick stroke keeps
  // its whole width clickable.
  const scale = Math.max(zoom, 0.01);
  // Six screen pixels of slack on *either side* of the ink, at whichever zoom the
  // click happens at: `pen.select` says "within 6 screen pixels of a stroke's
  // line", which is a distance from the line, not a band to be halved again. It
  // never goes below half the ink's own width, so a thick stroke keeps all of
  // itself clickable and a thin one is still something a hand can aim at.
  const radius = Math.max(
    strokeWidthWorld(style.thickness) / 2,
    STROKE_HIT_TOLERANCE_PX / scale,
  );
  const envelope = segmentStroke(
    simplify(toPoints(snap.points), STROKE_SIMPLIFY_TOLERANCE_PX / scale),
    radius * 2,
    snap.closed === true,
  );
  const points = toPoints(snap.points);
  const box = strokeBBox(points);
  const padding = radius * 2;
  const hit: StrokeHitWithZoom = {
    zoom,
    bbox: {
      x: box.x - padding,
      y: box.y - padding,
      width: box.width + padding * 2,
      height: box.height + padding * 2,
    },
    contains(x: number, y: number): boolean {
      return envelope.contains({ x, y });
    },
  };
  HIT_CACHE.set(snap, hit);
  return hit;
}

/** Does this point land on the ink? `point` is relative to the stroke. */
export function hitTestStroke(snap: StrokeSnap, point: Point, zoom = 1): boolean {
  return strokeHit(snap, zoom).contains(point.x, point.y);
}

/** The keys that decide how a stroke looks, and so whether an edit is dirty. */
const STYLE_KEYS = ['color', 'thickness', 'closed'] as const;

/** Whether writing this stroke changes anything (4.1 `strokeDirty`). */
export function strokeDirty(
  before: StrokeSnap | null | undefined,
  after: StrokeSnap,
): boolean {
  if (!before) return true;
  if (before.points.length !== after.points.length) return true;
  for (let i = 0; i < after.points.length; i++) {
    if (before.points[i] !== after.points[i]) return true;
  }
  for (const key of STYLE_KEYS) {
    if (before[key] !== after[key]) return true;
  }
  return !(before.width === after.width && before.height === after.height);
}

/** An independent copy of a point list: every capture owns its own buffer. */
export function clonePoints(flat: readonly number[]): number[] {
  return [...flat];
}

/** An independent copy of a whole stroke (one undo step for a paste). */
export function cloneStroke(snap: StrokeSnap): StrokeSnap {
  return { ...snap, points: [...snap.points] };
}

/**
 * Rescale the ink to a new box (3.4: a resize is a *rescale*, not a scale of a
 * path built from the old points). `sx`/`sy` are the new box over the old one.
 */
export function scaleStroke(
  snap: StrokeSnap,
  sx: number,
  sy: number,
): StrokeSnap {
  const points: number[] = [];
  for (let i = 0; i < snap.points.length; i += 2) {
    points.push(round(snap.points[i]! * sx), round(snap.points[i + 1]! * sy));
  }
  return {
    ...snap,
    points,
    width: Math.max(0, round(snap.width * sx)),
    height: Math.max(0, round(snap.height * sy)),
  };
}

/** What goes into the `Y.Map`, in one transaction (3.2). */
export function strokeToRecord(snap: StrokeSnap): Record<string, unknown> {
  return {
    type: 'stroke',
    x: snap.x,
    y: snap.y,
    width: snap.width,
    height: snap.height,
    points: snap.points,
    baseWidth: snap.baseWidth,
    baseHeight: snap.baseHeight,
    color: snap.color,
    thickness: snap.thickness,
    closed: snap.closed,
    z: snap.z,
    createdAt: snap.createdAt,
    createdBy: snap.createdBy,
  };
}

/** What comes out of a `Y.Map`: repair, never reject (3.1). */
export function strokeFromRecord(
  id: string,
  record: Readonly<Record<string, unknown>>,
): StrokeSnap | null {
  const points = Array.isArray(record.points) ? (record.points as unknown[]) : null;
  // Two numbers are a drawing: the dot a pen leaves when it does not move is one
  // point, and a reader that asked for more would drop other people's dots while
  // drawing its own.
  if (!points || points.length < 2 || points.length % 2 !== 0) return null;
  const flat = points as number[];
  if (!flat.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return null;
  }
  const style = strokeStyle({
    color: typeof record.color === 'string' ? record.color : DEFAULT_PEN_COLOR,
    thickness:
      typeof record.thickness === 'string' ? record.thickness : DEFAULT_PEN_THICKNESS,
  });
  const box = strokeBBox(toPoints(flat));
  const width = typeof record.width === 'number' && record.width > 0 ? record.width : box.width;
  const height =
    typeof record.height === 'number' && record.height > 0 ? record.height : box.height;
  return {
    id,
    type: 'stroke',
    x: typeof record.x === 'number' ? record.x : 0,
    y: typeof record.y === 'number' ? record.y : 0,
    width,
    height,
    z: typeof record.z === 'number' ? record.z : 0,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    createdBy: typeof record.createdBy === 'string' ? record.createdBy : '',
    points: flat,
    baseWidth: width > 0 ? width : 1,
    baseHeight: height > 0 ? height : 1,
    color: style.color,
    thickness: style.thickness,
    closed: record.closed === true,
  };
}

/**
 * Store a stroke, in exactly one transaction.
 *
 * `at` is the top-left of the ink's box and `flat` the ink relative to it, so
 * the two together put the drawing where it was drawn; `points` are never
 * absolute, which is what keeps a move and a resize of a stroke honest. The box
 * is recomputed here rather than trusted: a caller that got it wrong gets a
 * correct object, not a stroke drawn offset from where it was drawn.
 */
export function createStroke(
  doc: Y.Doc,
  flat: readonly number[],
  at: Point,
  options: {
    width?: number;
    height?: number;
    color?: PenColor;
    thickness?: PenThickness;
    closed?: boolean;
    by?: string;
    z?: number;
    /** Write under this id (a paste brings its own); a clash is refused. */
    id?: string;
  } = {},
): string {
  if (flat.length < 2 || flat.length % 2 !== 0) return '';
  // Checked on the raw numbers rather than on the points they turn into, because
  // `toPoints` quietly drops a pair it cannot read: a gesture that loses half its
  // ink is the same broken gesture wearing a different hat, and a one-point ink
  // is now a legal drawing, so "it came out as one point" no longer proves
  // anything by itself.
  for (let i = 0; i < flat.length; i += 2) {
    if (!Number.isFinite(flat[i]) || !Number.isFinite(flat[i + 1])) return '';
  }
  const points = toPoints(flat);
  if (points.length === 0) return '';
  const box = strokeBBox(points);
  const objects = objectsMap(doc);
  const style = strokeStyle({
    color: options.color ?? DEFAULT_PEN_COLOR,
    thickness: options.thickness ?? DEFAULT_PEN_THICKNESS,
  });
  // A dot is as wide as the pen: its ink is one point, so the box is what that
  // point *covers* rather than what it measures, and the box has to be a real
  // box or there is nowhere for the round cap to be drawn. The thickness width
  // goes into `baseWidth` too, so a proportional resize scales a dot as a dot.
  const boxWidth = points.length === 1
    ? strokeWidthWorld(style.thickness)
    : Math.max(box.width, 1);
  const boxHeight = points.length === 1
    ? strokeWidthWorld(style.thickness)
    : Math.max(box.height, 1);
  const id =
    options.id ??
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `stroke-${Math.random().toString(36).slice(2)}`);
  // An id that is already taken is not ours to overwrite: a paste of a stroke
  // that came from somewhere else has to become a *new* object or the old one
  // silently changes under the person who owns it.
  if (objects.get(id) !== undefined) return '';
  const record: Record<string, unknown> = strokeToRecord({
    id,
    type: 'stroke',
    x: at.x,
    y: at.y,
    width: options.width ?? boxWidth,
    height: options.height ?? boxHeight,
    z: options.z ?? 1,
    createdAt: Date.now(),
    createdBy: options.by ?? '',
    points: toFlat(points),
    baseWidth: boxWidth,
    baseHeight: boxHeight,
    color: style.color,
    thickness: style.thickness,
    closed: options.closed === true,
  });
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(record)) {
      map.set(key, Array.isArray(value) ? [...value] : value);
    }
    objects.set(id, map);
  }, LOCAL_ORIGIN);
  return id;
}

/** Read one stroke back out of the document, repaired. */
export function getStroke(doc: Y.Doc, id: string): StrokeSnap | null {
  const value = objectsMap(doc).get(id);
  if (!(value instanceof Y.Map) || value.get('type') !== 'stroke') return null;
  const record: Record<string, unknown> = {};
  (value as Y.Map<unknown>).forEach((item, key) => {
    record[key] = item;
  });
  return strokeFromRecord(id, record);
}

/** Replace a stroke's ink and style, in one transaction. */
export function updateStroke(
  doc: Y.Doc,
  id: string,
  stroke: Pick<
    StrokeSnap,
    'points' | 'color' | 'thickness' | 'closed' | 'width' | 'height'
  >,
): boolean {
  const value = objectsMap(doc).get(id);
  if (!(value instanceof Y.Map) || value.get('type') !== 'stroke') return false;
  const before = strokeFromRecord(id, {
    points: value.get('points'),
    color: value.get('color'),
    thickness: value.get('thickness'),
    closed: value.get('closed'),
    width: value.get('width'),
    height: value.get('height'),
  });
  if (!before) return false;
  const next: StrokeSnap = {
    ...before,
    points: [...stroke.points],
    color: stroke.color,
    thickness: stroke.thickness,
    closed: stroke.closed,
    width: stroke.width,
    height: stroke.height,
  };
  if (!strokeDirty(before, next)) return false;
  doc.transact(() => {
    const map = value as Y.Map<unknown>;
    map.set('points', [...next.points]);
    map.set('color', next.color);
    map.set('thickness', next.thickness);
    map.set('closed', next.closed);
    map.set('width', next.width);
    map.set('height', next.height);
  }, LOCAL_ORIGIN);
  return true;
}
