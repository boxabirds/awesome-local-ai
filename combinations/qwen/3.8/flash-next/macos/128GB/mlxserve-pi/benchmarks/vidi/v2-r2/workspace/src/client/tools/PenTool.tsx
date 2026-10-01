// The Pen tool (story 11): press, drag, let go, and a line is drawn.
//
// It is the Shape tool's sibling in everything that matters - a layer over the whole
// board, above every object, screen-sized, that takes the next press whatever it
// lands on. That is what makes "a Pen drag that starts on a sticky note moves nothing
// and pans nothing": the press is captured to this layer, and neither the note under
// the pointer nor the board ever hears about it. The wheel and the trackpad gesture
// are still the board's listeners above, so scrolling and zooming go on working while
// the Pen is held - and the stroke being drawn goes on following the pointer, because
// the points it collects are board points and the camera only decides where they are
// drawn.
//
// Two things about the gesture are deliberate opposites of the Shape tool's:
//
//   - a drag the *system* ends (pointercancel, lost pointer capture) is a finished
//     stroke, not a discarded one. Ink the hand already laid down is kept - there is
//     nothing to undo it and nothing to redraw it with;
//   - Escape while a stroke is in flight is the opposite: the points are dropped and
//     nothing is written, because Escape means "that was not the line I meant".
//
// The preview is local and never synced: it is React state in this layer, and the
// document is not touched until the stroke is finished. That is the whole of "nobody
// else sees a stroke until it is finished" - there is nothing in the transaction to
// send until the last point is in.
//
// The preview is redrawn at most once per animation frame however many pointer events
// arrived in it - a trackpad delivers ten coalesced moves between two frames, and a
// line redrawn ten times a frame is ten lines nobody looked at.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { simplify, smoothPath, splitPoints } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';

export interface PenToolProps {
  /** The camera the line is drawn under: board points in, screen points out. */
  camera: Camera;
  /** The colour and thickness in force when the stroke is finished. */
  color: PenColor;
  thickness: PenThickness;
  /** The document a finished stroke is written to. */
  doc: Y.Doc;
  /** What `createdBy` says on a stroke this gesture leaves behind. */
  identityId: string;
  /** A board that could not be read draws no strokes: the layer takes no presses. */
  canCreate: boolean;
  /**
   * A stroke was committed: the board makes it the selection. It is told and hears
   * nothing back - a stroke the model refused is a stroke that is not on the board -
   * and the board keeps the Pen tool held, because drawing the next line is the
   * thing a person holding a pen does next.
   */
  onCreated?(id: string): void;
  /**
   * Close the current undo window. Called on both sides of every committed stroke, so
   * two strokes drawn in the same heartbeat are two undo steps and one long stroke
   * that had to be split is two as well.
   */
  onBoundary?(): void;
}

/** A press that may still turn into a stroke. */
interface StrokeGesture {
  pointerId: number;
  /** The line so far, in board units. Mutated in place; the preview reads it. */
  points: Point[];
  /** Where the press began, on the board: what a tap is drawn from. */
  start: Point;
  /** Where the press began, on the screen: what "it never moved" is measured from. */
  startX: number;
  startY: number;
  /** Where the pointer last was, in screen units: where the cursor dot sits. */
  x: number;
  y: number;
  /** True once the pointer travelled enough to be a line rather than a tap. */
  moved: boolean;
}

/** The local preview: the path in screen units, and where the pointer is. */
interface PenPreview {
  d: string;
  /** Screen coordinates of the pen's tip, for the round cursor. */
  x: number;
  y: number;
  /** How many points the line in flight holds: reported, never stored. */
  points: number;
}

export function PenTool({
  camera,
  color,
  thickness,
  doc,
  identityId,
  canCreate,
  onCreated,
  onBoundary,
}: PenToolProps): JSX.Element {
  const press = useRef<StrokeGesture | null>(null);
  const frame = useRef<number | null>(null);
  /** The newest camera, so a zoom mid-stroke cannot leave a frame dividing by the old one. */
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  /** Same props, readable from the commit that happens inside a pointer handler. */
  const propsRef = useRef({ color, thickness, doc, identityId, canCreate, onCreated, onBoundary });
  propsRef.current = { color, thickness, doc, identityId, canCreate, onCreated, onBoundary };
  const [preview, setPreview] = useState<PenPreview | null>(null);

  /** Where a pointer event is on the board. */
  const worldOf = (event: { clientX: number; clientY: number }): Point =>
    screenToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });

  const stopFrame = useCallback((): void => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  // A layer that goes away mid-stroke must not leave a queued frame drawing a stroke
  // nobody is holding a pen in any more.
  useEffect(() => stopFrame, [stopFrame]);

  /** The preview for the line in flight, as it would look at this camera. */
  const renderPreview = useCallback((): void => {
    const current = press.current;
    if (current === null) {
      setPreview(null);
      return;
    }
    const screen: Point[] = [];
    for (const point of current.points) screen.push(worldToScreen(cameraRef.current, point));
    setPreview({ d: smoothPath(screen), x: current.x, y: current.y, points: current.points.length });
  }, []);

  /** Ask for one preview redraw, unless this frame already asked for one. */
  const scheduleFrame = useCallback((): void => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      renderPreview();
    });
  }, [renderPreview]);

  /**
   * Write one part of the line as a stroke: simplified by the zoom it was drawn at,
   * in the colour and thickness in force, as its own undo step.
   *
   * The tolerance is a screen measurement, so it is divided by the zoom: a line drawn
   * at 200% keeps detail half as far apart in board units as one drawn at 100%, which
   * is what makes the stored line one screen pixel faithful either way.
   */
  const commit = useCallback((points: readonly Point[]): void => {
    if (points.length === 0) return;
    const { color: ink, thickness: weight, doc: document, identityId: who, onCreated: created, onBoundary: boundary } =
      propsRef.current;
    boundary?.();
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / cameraRef.current.zoom;
    const id = createStroke(document, { points: simplify(points, tolerance), color: ink, thickness: weight }, who);
    // A stroke the model refused - no points, a coordinate that is not a number - is
    // discarded in silence, exactly as a drag of nothing is: the preview goes and
    // nothing is on the board.
    if (id !== null) created?.(id);
    boundary?.();
  }, []);

  /**
   * End the gesture: `keep` says whether the line in flight becomes a stroke. A tap
   * that never travelled is committed as the single point it is, which is the dot the
   * PRD asks for and not a shapeless blob of the jitter a still hand reports.
   */
  const finish = useCallback(
    (keep: boolean): void => {
      const current = press.current;
      stopFrame();
      press.current = null;
      setPreview(null);
      if (current === null) return;
      if (!keep) return;
      if (current.moved) commit(current.points);
      else commit([current.start]);
    },
    // every value the gesture owns is read out of a ref, so a camera or colour change
    // mid-stroke cannot leave the release working from stale ones
    [commit, stopFrame],
  );

  /**
   * Escape, with a stroke in flight. The points are dropped and nothing is written.
   *
   * This runs as its own listener rather than as a rule inside the board's Escape
   * handling, and it has to: the board's handler answers Escape by putting the tool
   * back to Select, which takes this layer out of the page - and a layer that is gone
   * has no gesture left to discard, so the points would be committed by the very
   * capture loss that Escape caused.
   */
  const discard = useCallback((): void => {
    stopFrame();
    press.current = null;
    setPreview(null);
  }, [stopFrame]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || press.current === null) return;
      event.preventDefault();
      discard();
      // The board's own Escape handler is still free to run - it is the one that puts
      // the tool back on Select, which is what Escape is also for.
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [discard]);

  /**
   * Every pointer report this event carries. A trackpad or a pen delivers several
   * coalesced moves inside one event; a browser that has no `getCoalescedEvents`
   * (and jsdom, which has no coalescing at all) delivers the event itself, which is
   * the one point that would have been taken anyway.
   */
  const pointsOf = (event: ReactPointerEvent<HTMLDivElement>): Point[] => {
    const native = event.nativeEvent as PointerEvent & {
      getCoalescedEvents?: () => PointerEvent[];
    };
    const coalesced =
      typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const reports = coalesced.length > 0 ? coalesced : [native];
    const world: Point[] = [];
    for (const report of reports) {
      if (typeof report?.clientX !== 'number' || typeof report?.clientY !== 'number') continue;
      world.push(worldOf(report));
    }
    return world;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // The press belongs to the pen wherever it lands: no pan, no marquee, no clear of
    // the selection, and above all no grab of the object the line happens to start on.
    event.stopPropagation();
    if (!propsRef.current.canCreate) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const world = worldOf(event);
    press.current = {
      pointerId: event.pointerId,
      points: [world],
      start: world,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    scheduleFrame();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    const added = pointsOf(event);
    for (const point of added) current.points.push(point);
    current.x = event.clientX;
    current.y = event.clientY;
    if (!current.moved) {
      // under a few pixels the pointer is a tap, which is a dot and not a line
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= DRAG_THRESHOLD_PX) {
        current.moved = true;
      }
    }

    // A gesture longer than one stroke may hold is committed in parts, as it goes,
    // rather than lost at the end. Each part is a stroke of its own and the next one
    // begins at the point the previous one ended at, so the two join with no gap.
    if (current.points.length >= STROKE_MAX_POINTS) {
      const parts = splitPoints(current.points);
      const last = parts[parts.length - 1] ?? [];
      for (let i = 0; i < parts.length - 1; i += 1) commit(parts[i]!);
      // the line in flight carries on from the point the last part was drawn to
      current.points = last;
    }

    scheduleFrame();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    // the last point is the one under the pointer where it lifted
    for (const point of pointsOf(event)) current.points.push(point);
    finish(true);
  };

  // A drag cut short by the system is a finished stroke: the ink the hand already
  // laid down is kept, not thrown away.
  const onCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    finish(true);
  };

  // A double-click is the pen's: it taps twice and draws two dots. It is never the
  // board's "double-click the board makes a sticky note".
  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };

  const zoom = camera.zoom;

  return (
    <div
      className="pen-tool-layer"
      data-testid="pen-tool-layer"
      data-drawing={preview !== null}
      data-pen-color={color}
      data-pen-thickness={thickness}
      data-can-create={canCreate}
      data-points={preview?.points ?? 0}
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onCancel}
      onLostPointerCapture={onCancel}
      onDoubleClick={onDoubleClick}
    >
      {preview === null ? null : (
        <>
          {/* The line in flight, in screen units, in the colour and thickness it will
              be stored in. It is drawn here and nowhere else: no other client can see
              it, because it was never written to the document. */}
          <svg className="pen-preview" data-testid="pen-preview" aria-hidden="true" focusable="false">
            <path
              data-testid="pen-preview-path"
              d={preview.d}
              stroke={PEN_COLORS[color]}
              strokeWidth={PEN_THICKNESS_WORLD[thickness] * zoom}
            />
          </svg>
          {/* The pen's tip: a round cursor the thickness of the line it is drawing, so
              the thickness picked can be seen before it is drawn. */}
          <span
            className="pen-cursor"
            data-testid="pen-cursor"
            style={{
              left: `${preview.x}px`,
              top: `${preview.y}px`,
              width: `${PEN_THICKNESS_WORLD[thickness] * zoom}px`,
              height: `${PEN_THICKNESS_WORLD[thickness] * zoom}px`,
              background: PEN_COLORS[color],
            }}
          />
        </>
      )}
    </div>
  );
}
