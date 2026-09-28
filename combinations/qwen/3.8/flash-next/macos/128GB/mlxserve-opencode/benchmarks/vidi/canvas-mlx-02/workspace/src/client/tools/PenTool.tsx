// The Pen tool (story 11, pen.tool): hold the pointer down and move it, and what
// you drew becomes a stroke.
//
// It is a surface, not a cursor hint - the same arrangement the Shape and Connector
// tools reached with the viewport, and for the same reason: while the Pen is open it
// is the only thing that sees a press, so a drag that starts on top of a sticky note
// draws a line over it instead of dragging the note out of the way (pen.navigation).
// It is mounted INSIDE the viewport element rather than beside it, which is the one
// difference: a wheel or a pinch over the pen still reaches the board's own wheel
// handler, so panning and Ctrl/Cmd+scroll zooming carry on working while somebody is
// between strokes.
//
// What it does is deliberately split in two. While the pointer moves it keeps the
// recorded points to itself and paints a cheap screen-space line once per animation
// frame - nothing of that is ever written, so nobody else sees a half-drawn stroke
// (pen.share). Only when the pen lifts does it do the expensive, shared work:
// simplify the recording to the tolerance the settings allow, and hand it to the
// stroke model as one transaction, which is one undo step.
import { useRef, useState } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import { createStroke, isPenColor, isPenThickness } from '../../shared/objects/stroke.ts';
import { simplify } from '../../shared/geometry/simplify.ts';
import { screenToWorld, worldToScreen } from '../canvas/camera.ts';
import type { Camera, Point } from '../canvas/camera.ts';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config.ts';
import type { PenColor, PenThickness } from '../../shared/config.ts';
import { useUndoController } from '../board/useUndo.ts';

export interface PenToolProps {
  /** the live camera: a screen point is a board point only through it */
  camera: Camera;
  /** what the pen toolbar picked (session state; never the doc's) */
  color: PenColor;
  thickness: PenThickness;
  /** the board to write to (the tool is only ever mounted on an editable board) */
  doc: Y.Doc;
  /** whose pen this is: stored as the stroke's provenance (story 5 arrives later) */
  identityId: string;
}

interface Drawing {
  pointerId: number;
  /** where the pen landed, in world units - a stroke is measured from here */
  start: Point;
  startScreen: Point;
  /** the part of the recording that has not been committed yet, in world units */
  points: Point[];
  /** a press that never moved is a dot, not a stroke */
  moved: boolean;
}

/** The in-progress line, as an ordinary polyline: smoothing is for the finished stroke. */
function livePath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) d += ` L ${points[i].x} ${points[i].y}`;
  return d;
}

export function PenTool(props: PenToolProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drawing | null>(null);
  const frame = useRef<number | null>(null);

  // The preview is the only React state, and the only thing that puts it there is
  // an animation frame: a browser can deliver a dozen pointermove events between two
  // paints, and redrawing the line twelve times paints nothing sooner.
  const [preview, setPreview] = useState<readonly Point[] | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  // The handlers read the CURRENT props through a ref, so a camera that panned or a
  // colour picked mid-stroke cannot be missed by a stale closure - the stroke is
  // smoothed at the zoom it was drawn at, and in the colour that is set now.
  const latest = useRef(props);
  latest.current = props;
  const undo = useUndoController();

  const screenPoint = (e: { clientX: number; clientY: number }): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const worldOf = (e: { clientX: number; clientY: number }): Point =>
    screenToWorld(latest.current.camera, screenPoint(e));

  const zoomNow = (): number => {
    const zoom = latest.current.camera.zoom;
    return zoom > 0 ? zoom : 1;
  };

  const stopFrame = (): void => {
    if (frame.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  // Paint the line the pen has recorded so far - once per frame, which is as
  // immediate as anything on a screen can be.
  const scheduleFrame = (): void => {
    if (frame.current !== null) return;
    const write = () => {
      frame.current = null;
      const d = drag.current;
      if (!d) return;
      setPreview(d.points.map((p) => ({ ...p })));
    };
    if (typeof requestAnimationFrame !== 'function') {
      write();
      return;
    }
    frame.current = requestAnimationFrame(write);
  };

  /**
   * Finish one stroke: smooth it to the tolerance the settings allow AT THE ZOOM IT
   * WAS DRAWN AT (a pixel of screen is 1/zoom world units, which is what makes a
   * stroke as faithful when drawn at 200% as at 100%), and write it as one
   * transaction between two undo boundaries.
   *
   * A null from the model - a colour or a path it would not take - leaves nothing
   * behind: the preview is already cleared and no stroke appears.
   */
  const commit = (points: readonly Point[], moved: boolean): string | null => {
    if (points.length === 0) return null;
    const settings = latest.current;
    const path = moved ? simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoomNow()) : points.slice(0, 1);
    if (path.length === 0) return null;
    if (!isPenColor(settings.color) || !isPenThickness(settings.thickness)) return null;

    undo?.boundary();
    const id = createStroke(settings.doc, { points: path, color: settings.color, thickness: settings.thickness }, settings.identityId);
    undo?.boundary();
    return id;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current) return;
    // The press belongs to the pen: nothing below it - an object, the pan, the
    // marquee - is ever told about it.
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom / unsupported */
    }
    const start = worldOf(e);
    drag.current = {
      pointerId: e.pointerId,
      start,
      startScreen: screenPoint(e),
      points: [start],
      moved: false,
    };
    setCursor(screenPoint(e));
    setPreview([start]);
    scheduleFrame();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const point = screenPoint(e);
    const d = drag.current;
    if (!d) {
      // The round cursor follows the pen between strokes, at the size the line it
      // is about to draw would be.
      setCursor(point);
      return;
    }

    // Everything the browser coalesced into this one event is part of the drawing;
    // dropping it would be drawing the path the hand did not take. The main event is
    // the last of them, so a browser that cannot say costs nothing.
    const native = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const added = coalesced.length > 0 ? coalesced.map((c) => worldOf(c)) : [worldOf(e)];

    for (const p of added) {
      d.points.push(p);
      if (!d.moved) {
        const last = d.points[d.points.length - 1];
        const far = worldToScreen(latest.current.camera, last);
        if (Math.hypot(far.x - d.startScreen.x, far.y - d.startScreen.y) >= DRAG_THRESHOLD_PX) d.moved = true;
      }
      if (d.points.length >= STROKE_MAX_POINTS) {
        // The recording has reached what one stroke may hold. Put this part down and
        // start the next one ON THE POINT THIS ONE ENDED ON: two strokes drawn
        // end to end are still the line that was drawn, with no gap in it.
        const finished = d.points;
        d.points = [finished[finished.length - 1]];
        commit(finished, true);
      }
    }
    // The cursor dot is the pen's tip BETWEEN strokes; while one is being drawn the
    // line itself ends at the pointer, which says the same thing and costs no render.
    scheduleFrame();
  };

  /** Lift the pen. An interrupted stroke is a stroke: it keeps what it recorded. */
  const finish = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    stopFrame();
    setPreview(null);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* jsdom / unsupported */
    }
    // A press that never moved is a dot: one point, as wide as the pen is thick,
    // which is an object with a box of its own rather than an invisible mark.
    commit(d.points, d.moved);
  };

  const cam = props.camera;
  const thicknessWorld = PEN_THICKNESS_WORLD[props.thickness] ?? PEN_THICKNESS_WORLD.medium;
  const shown =
    preview && preview.length > 0
      ? preview.map((p) => worldToScreen(cam, p))
      : null;

  return (
    <div
      ref={rootRef}
      data-testid="pen-tool"
      data-color={props.color}
      data-thickness={props.thickness}
      role="presentation"
      aria-label="Pen tool: drag to draw"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        cursor: 'crosshair',
        // A pen stroke is a touch or a pointer drag: the browser must never turn one
        // into a scroll of its own.
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={(e) => {
        // A double-click is two pen presses, never the board's "new note".
        e.stopPropagation();
      }}
    >
      {/* The line being drawn, in screen pixels: it is what the pen looks like it is
          doing, and it exists only here. Nothing of it is written to the doc, so
          another person's screen shows the stroke appear when it is finished and
          never before. */}
      {shown ? (
        <svg
          data-testid="pen-preview"
          data-color={props.color}
          width="100%"
          height="100%"
          style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
          aria-hidden="true"
        >
          <path
            data-testid="pen-preview-path"
            d={livePath(shown)}
            fill="none"
            stroke={PEN_COLORS[props.color] ?? PEN_COLORS.black}
            strokeWidth={thicknessWorld * cam.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}

      {/* The pen's own tip: the point it will draw with, at the size it will draw. */}
      {cursor ? (
        <div
          data-testid="pen-cursor"
          style={{
            position: 'fixed',
            left: cursor.x - (thicknessWorld * cam.zoom) / 2,
            top: cursor.y - (thicknessWorld * cam.zoom) / 2,
            width: Math.max(2, thicknessWorld * cam.zoom),
            height: Math.max(2, thicknessWorld * cam.zoom),
            borderRadius: '50%',
            background: PEN_COLORS[props.color] ?? PEN_COLORS.black,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
}
