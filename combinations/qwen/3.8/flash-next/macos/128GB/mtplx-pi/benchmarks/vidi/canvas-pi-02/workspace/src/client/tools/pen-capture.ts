/**
 * Pen capture (story 11, design §3.1, §4.1, §4.5).
 *
 * A capture is one continuous run of the pointer: it starts at pointerdown, grows
 * on every move, and ends at pointerup or pointercancel (both commit — a pen that
 * is lifted, however it was lifted, drew what it drew) or at Escape or a tool
 * change (both discard, because those are the person saying "throw it away").
 * The buffer holds the ink in **world units**, which is what makes a zoom in the
 * middle of a draw possible: the points do not have to be re-derived from screen
 * pixels, because they were never screen pixels.
 *
 * Nothing in here touches the DOM or React. `PenTool` owns the pointer and the
 * preview; this owns the data, so both halves can be tested without a browser.
 */
import { STROKE_MAX_POINTS, STROKE_SIMPLIFY_TOLERANCE_PX } from '../../shared/config';
import {
  createStroke,
  strokeBBox,
  strokeWidthWorld,
  toFlat,
  toPoints,
  type StrokeSnap,
} from '../../shared/objects/stroke';
import { dedupe, simplify } from '../../shared/geometry/simplify';
import type { Point } from '../../shared/geometry';

/**
 * The two steps every stroke goes through on its way into the document, in one
 * place so the preview and the committed stroke cannot disagree: drop the points
 * that are on top of each other, then the ones the line does not need.
 *
 * The de-duplication distance is tied to the tolerance instead of to a fixed
 * world distance, so zooming in does not make the pen coarser.
 */
function smooth(points: readonly Point[], tolerance: number): Point[] {
  if (!(tolerance > 0)) return [...points];
  return simplify(dedupe(points, Math.min(0.5, tolerance * 0.25)), tolerance);
}

/** One continuous run of the pen, in world units. */
export interface PenCapture {
  /** Flattened ink: `[x0, y0, x1, y1, …]`, absolute world coordinates. */
  points: number[];
  /** Whether the run came back near where it started (§4.4). */
  closed: boolean;
  /** The stroke being drawn right now, or null for a plain line. */
  current: number[];
  /** Ids committed so far, when a long stroke had to be split. */
  committed: number[];
}

/** Start a new capture at the pointer's first world position. */
export function beginCapture(x: number, y: number): PenCapture {
  return { points: [x, y], closed: false, current: [x, y], committed: [] };
}

/**
 * Add a sample. False when it is a duplicate: a pen held still at the end of a
 * stroke produces one identical point per frame, and keeping those would grow a
 * buffer for a line that does not move.
 */
export function extendCapture(capture: PenCapture, x: number, y: number): boolean {
  const points = capture.current;
  const length = points.length;
  if (length >= 2 && points[length - 2] === x && points[length - 1] === y) return false;
  points.push(x, y);
  // The budget is counted in points, and a stroke that runs out of it is split
  // rather than truncated: the next part starts where the last one ended, so
  // the drawn line has no gap in it (`pen.long_stroke`).
  if (points.length / 2 >= STROKE_MAX_POINTS) {
    capture.committed.push(...points);
    capture.current = [x, y];
  }
  return true;
}

/** How far apart the two ends of a capture are, relative to its size. */
export function captureClosingGap(points: readonly number[]): number {
  if (points.length < 6) return Infinity;
  const first = { x: points[0]!, y: points[1]! };
  const last = { x: points[points.length - 2]!, y: points[points.length - 1]! };
  const anchor = { x: points[points.length - 4]!, y: points[points.length - 3]! };
  const chord = Math.hypot(first.x - anchor.x, first.y - anchor.y);
  if (!(chord > 0)) return Infinity;
  return Math.hypot(first.x - last.x, first.y - last.y) / chord;
}

/** What the pointer left behind, or null when there is nothing to draw. */
export interface FinishedStroke {
  /** The ink, relative to `bbox`; the closing point is already dropped. */
  points: number[];
  /** Absolute world box of the ink. */
  bbox: { x: number; y: number; width: number; height: number };
  closed: boolean;
}

/**
 * Close a capture: detect the ring, drop the closing point, simplify, and cut
 * the result into the boxes that go into the document.
 *
 * A capture that comes back within two percent of where it started is a closed
 * stroke, and the last point — the walk back to the start — is dropped: a stroke
 * that closes is a *closed stroke*, not a shape.
 */
/**
 * Close a capture: detect the ring, drop the closing point, simplify, and cut
 * the result into the boxes that go into the document.
 *
 * A capture that comes back within two percent of where it started is a closed
 * stroke, and the last point — the walk back to the start — is dropped: a stroke
 * that closes is a *closed stroke*, not a shape.
 *
 * `tolerance` is the simplifier's, in world units: the caller divides the screen
 * tolerance by the zoom, so a line drawn while zoomed in keeps its detail and the
 * same line drawn at 25% stays smooth (`pen.smooth`). Both the preview and the
 * committed stroke go through this, which is what keeps them identical.
 */
export function finishCapture(
  capture: PenCapture,
  tolerance = STROKE_SIMPLIFY_TOLERANCE_PX,
): FinishedStroke[] {
  const runs = [...capture.committed.length ? [capture.committed] : [], capture.current];
  const finished: FinishedStroke[] = [];
  for (const run of runs) {
    if (run.length < 4) continue;
    const closed = captureClosingGap(run) < 0.02;
    const ink = closed ? run.slice(0, run.length - 2) : [...run];
    if (ink.length < 4) continue;
    const points = smooth(toPoints(ink), tolerance);
    if (points.length < 2) continue;
    const bbox = strokeBBox(points);
    const relative = points.map((point) => ({
      x: point.x - bbox.x,
      y: point.y - bbox.y,
    }));
    finished.push({
      points: toFlat(relative),
      bbox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
      closed,
    });
  }
  return finished;
}

/**
 * Write a finished capture into the document, in one transaction per stroke.
 * Returns the ids created; an empty array means nothing was written.
 */
export function commitCapture(
  doc: import('yjs').Doc,
  capture: PenCapture,
  options: {
    color: import('../../shared/config').PenColor;
    thickness: import('../../shared/config').PenThickness;
    by?: string;
    z?: number;
    tolerance?: number;
  },
): string[] {
  const finished = finishCapture(capture, options.tolerance ?? STROKE_SIMPLIFY_TOLERANCE_PX);
  const ids: string[] = [];
  for (const stroke of finished) {
    const id = createStroke(
      doc,
      stroke.points,
      { x: stroke.bbox.x, y: stroke.bbox.y },
      {
        width: Math.max(stroke.bbox.width, 1),
        height: Math.max(stroke.bbox.height, 1),
        color: options.color,
        thickness: options.thickness,
        closed: stroke.closed,
        by: options.by ?? 'local',
        z: options.z,
      },
    );
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * The ink of a pen that touched the glass and did not move: one point, in a box
 * as wide as the pen (`pen.dot`). The box is not the ink's box — a point has no
 * box — it is what the ink covers, which is why the point sits in the middle of
 * it rather than in its corner.
 */
export function dotStroke(
  x: number,
  y: number,
  thickness: import('../../shared/config').PenThickness,
): FinishedStroke {
  const edge = strokeWidthWorld(thickness);
  return {
    points: [edge / 2, edge / 2],
    bbox: { x: x - edge / 2, y: y - edge / 2, width: edge, height: edge },
    closed: false,
  };
}

/**
 * Write the dot a click without movement draws. It is its own entry point rather
 * than a case inside `commitCapture`, because whether a gesture travelled far
 * enough to be a line is a question about the pointer, and the pointer is not in
 * here.
 */
export function commitDot(
  doc: import('yjs').Doc,
  x: number,
  y: number,
  options: {
    color: import('../../shared/config').PenColor;
    thickness: import('../../shared/config').PenThickness;
    by?: string;
    z?: number;
  },
): string[] {
  const dot = dotStroke(x, y, options.thickness);
  const id = createStroke(doc, dot.points, { x: dot.bbox.x, y: dot.bbox.y }, {
    width: dot.bbox.width,
    height: dot.bbox.height,
    color: options.color,
    thickness: options.thickness,
    closed: false,
    by: options.by ?? 'local',
    z: options.z,
  });
  return id === '' ? [] : [id];
}

/**
 * The live capture as a snapshot, for the preview layer to draw.
 *
 * The preview draws through the same `buildStrokeRender` the committed stroke
 * uses, so a line cannot look different at the moment it lands: the preview is
 * the same geometry, one frame earlier (§4.3, §4.5).
 */
export function previewSnap(
  capture: PenCapture,
  style: {
    color: import('../../shared/config').PenColor;
    thickness: import('../../shared/config').PenThickness;
  },
  tolerance = STROKE_SIMPLIFY_TOLERANCE_PX,
): StrokeSnap[] {
  const runs = [...(capture.committed.length ? [capture.committed] : []), capture.current];
  const snaps: StrokeSnap[] = [];
  for (const run of runs) {
    if (run.length < 4) continue;
    const points = smooth(toPoints(run), tolerance);
    const bbox = strokeBBox(points);
    const relative = points.map((point) => ({
      x: point.x - bbox.x,
      y: point.y - bbox.y,
    }));
    snaps.push({
      id: 'preview',
      type: 'stroke',
      x: bbox.x,
      y: bbox.y,
      width: Math.max(bbox.width, 1),
      height: Math.max(bbox.height, 1),
      z: 0,
      createdAt: 0,
      createdBy: '',
      points: toFlat(relative),
      baseWidth: Math.max(bbox.width, 1),
      baseHeight: Math.max(bbox.height, 1),
      color: style.color,
      thickness: style.thickness,
      closed: captureClosingGap(run) < 0.02,
    });
  }
  return snaps;
}

/** The screen point of a pointer event, relative to the board area. */
export function localPoint(
  element: HTMLElement,
  event: { clientX: number; clientY: number },
): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

