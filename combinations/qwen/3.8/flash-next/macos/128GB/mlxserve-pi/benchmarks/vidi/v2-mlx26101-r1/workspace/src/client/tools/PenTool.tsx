// The Pen tool (story 11, pen.*): hold the board down and draw, let go and a stroke is there.
//
// Everything about this component follows from one rule: an unfinished stroke belongs to the
// person drawing it and to nobody else. So the line that follows the pointer is a DOM path in
// this component and nothing more — it is never written to the document, which means it cannot
// be seen by a colleague, cannot be undone, cannot be persisted and cannot be half-saved when
// the tab closes (pen.share). The document is opened exactly once per finished stroke, by the
// `onCreate` the board hands in, and the write is the smoothing rather than a decoration added
// afterwards: `simplify` is asked for the path it may keep at a zoom-scaled tolerance, so what
// appears is a bound on what was drawn and not a second opinion about it (pen.smooth).
//
// Four things in here are worth the explanation:
//
// 1. The press stops at this layer. The layer covers the board while the pen is held, so the
//    pointer is really on the tool and not on the note underneath: a pen stroke pans the board
//    never and moves the object under it never (pen.navigation).
//
// 2. The preview is painted into the DOM rather than through React state, once per animation
//    frame. A five-thousand-point path re-rendered sixty times a second is how a pen gets a
//    stutter, and the board has its own reasons to re-render while a person is drawing; the
//    preview's only job is to keep up with the pointer (pen.draw).
//
// 3. The wheel is forwarded to the camera. A wheel event goes to the element under the pointer
//    and then up through its ancestors, and this layer's ancestors do not include the board
//    surface — so a tool that covers the board would quietly take scrolling away. Holding a pen
//    must not maroon anyone in a zoom they cannot get out of (pen.navigation).
//
// 4. An interrupted press is a finished stroke, not a discarded one, and one press is one
//    stroke: a browser fires `pointerup` and then `lostpointercapture` for the same release, so
//    the drawing state is dropped before anything is written (pen.interrupted).
//
// The tool never calls `toolCreated` and never touches the selection: the pen stays in the hand
// until the person puts it down (pen.stay_active).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
import { createStroke } from '../../shared/objects/stroke';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import type { Point } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { WheelInput } from '../canvas/useCamera';
import { useUndoController } from '../board/useUndo';
import { useWindowPointer } from './useWindowPointer';
import { localPoint, toolLayerStyle, wheelInputFromEvent } from './toolSurface';

export interface PenToolProps {
  /**
   * The board document a finished stroke is written to — and the only document this component
   * ever touches. An unfinished stroke is in it zero times (pen.share), which is a property of
   * this component and not of a filter further down.
   */
  doc: Y.Doc;
  /** Who drew the stroke: the same author string the board writes every object with. */
  identityId: string;
  /** The board's surface element, for turning client points into board points. */
  surface: HTMLElement | null;
  /** The camera as it is rendered — the same object the board painted with. */
  camera: Camera;
  /** A board that cannot be edited cannot be drawn on: the layer takes no presses at all. */
  canEdit: boolean;
  /** Whether this tool is the tool the board is holding. */
  active: boolean;
  /** The pen the options toolbar says is chosen (pen.options). */
  color: PenColor;
  thickness: PenThickness;
  /** Pan / zoom the board with the wheel, exactly as the board itself does (pen.navigation). */
  onWheelInput(e: WheelInput): void;
}

/** One press: what has been recorded of it, in both of the spaces it is needed in. */
interface Draw {
  pointerId: number;
  /** Screen point the press went down at: the centre of the dot a click draws (pen.dot). */
  start: Point;
  /**
   * True once a recorded point left the button slop. A latch rather than a comparison at the
   * end, because a hand that went out and came back has drawn a line even though the pointer
   * finished where it started.
   */
  moved: boolean;
  /** The part of the path being drawn now, in board units: what the model is given. */
  points: Point[];
  /** The same part in screen pixels, which is what the preview is painted from. */
  screen: Point[];
}

/** The cursor's smallest and largest diameter on the screen, in CSS pixels. */
const CURSOR_MIN_PX = 6;
const CURSOR_MAX_PX = 64;

/**
 * A round cursor the size of the nib, in the colour it draws with, hot spot in its centre
 * (pen.draw's golden path: "the pointer becomes a small round cursor the size of the current
 * thickness"). Built as a data URL because CSS has no shape for "a circle of this diameter" and
 * a crosshair tells a person nothing about the pen they are holding. Clamped at both ends: at
 * 10% zoom a two-unit nib would be sub-pixel, and at 400% a thick one would cover the board.
 */
export function penCursor(color: PenColor, thicknessWorld: number, zoom: number): string {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const size = Math.max(
    CURSOR_MIN_PX,
    Math.min(CURSOR_MAX_PX, Math.round(thicknessWorld * z)),
  );
  const half = size / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<circle cx="${half}" cy="${half}" r="${Math.max(1, half - 1)}" ` +
    `fill="${PEN_COLORS[color]}" stroke="#ffffff" stroke-width="1"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(half)} ${Math.round(half)}, crosshair`;
}

/**
 * Every point the pointer passed between two frames. A coalesced burst is what the pointer
 * really did, and dropping the intermediate points would flatten away the very wobble that
 * smoothing then has to be honest about; a browser with no coalescing gives back nothing, and
 * then the event's own position is all there is.
 */
function batch(e: PointerEvent): PointerEvent[] {
  const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  return coalesced.length > 0 ? coalesced : [e];
}

export function PenTool({
  doc,
  identityId,
  surface,
  camera,
  canEdit,
  active,
  color,
  thickness,
  onWheelInput,
}: PenToolProps) {
  // The undo controller comes from context like every other consumer of it: a stroke is one
  // undo step, and a long press that had to be split into two strokes is two steps, because the
  // first of them is already on the board and cannot be joined to the second after the fact.
  const undo = useUndoController();
  // The camera, the pen and the surface are read through a ref refreshed on every render, so a
  // listener bound once for the mount never converts a point with the camera that happened to
  // be current when it was bound, and never draws a stroke in the colour that was chosen when
  // the press started rather than the one chosen during it.
  const live = useRef({ camera, color, thickness, surface });
  live.current = { camera, color, thickness, surface };

  const draw = useRef<Draw | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  /** True while a preview paint is in flight: the one-frame rule of `pen.draw`. */
  const pending = useRef(false);
  // The preview is mounted for the length of a press and painted imperatively, for the reason
  // in the header. Its colour and thickness are React's, and cannot drift: it is the same two
  // settings the stroke is written with.
  const [preview, setPreview] = useState(false);

  /** Repaint the preview from everything recorded of the press so far. */
  const paint = useCallback(() => {
    const el = pathRef.current;
    const d = draw.current;
    if (!el || !d) return; // the press ended while this frame was in flight
    el.setAttribute('d', smoothPath(d.screen));
  }, []);

  /** Paint at most once per displayed frame, however many points arrived in between. */
  const schedulePaint = useCallback(() => {
    if (pending.current) return;
    // Set before the call, not from its return value: a frame callback that runs immediately
    // (a test's synchronous requestAnimationFrame) must not leave the flag stuck on.
    pending.current = true;
    requestAnimationFrame(() => {
      pending.current = false;
      paint();
    });
  }, [paint]);

  /** Smooth one part of the path and write it. The model decides whether it is a stroke. */
  const commit = useCallback(
    (points: readonly Point[]): void => {
      if (points.length === 0) return;
      const cam = live.current.camera;
      const z = Number.isFinite(cam.zoom) && cam.zoom > 0 ? cam.zoom : 1;
      // One screen pixel of tolerance at the zoom the person drew at — the bound `pen.smooth`
      // promises, in the units the model stores. Dividing by the zoom is what makes the
      // smoothing the same size on the screen at 25% as at 400%: a fixed board tolerance would
      // shave a fine sketch to nothing and leave a zoomed-in one untouched.
      const kept = simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / z);
      // The boundary is opened before the write, as everywhere else in the board: one stroke,
      // one undo step (design: "stopCapturing, keep Pen active").
      undo?.boundary();
      createStroke(
        doc,
        {
          points: kept,
          // The pen as it is now, not as it was when the press began: someone who switched the
          // ink mid-draw means the ink they switched to (pen.options).
          color: live.current.color,
          thickness: live.current.thickness,
        },
        identityId,
      );
      // A `null` here is a path the model would not take — no points, a number that is not a
      // number, an ink nobody has. The preview has already been cleared by the caller and
      // nothing is written, which is the whole of what the board has to say about it (errors).
    },
    [doc, identityId, undo],
  );

  /**
   * End the press: one stroke, in the colour and thickness chosen, and nothing else. The
   * drawing state goes first, so the `lostpointercapture` that follows a real `pointerup` — and
   * any other path into this function — finishes a press that has already been finished rather
   * than writing it twice.
   */
  const finish = useCallback(() => {
    const d = draw.current;
    if (!d) return;
    draw.current = null;
    setPreview(false);
    // A press that never left the button slop is a dot: one point, which the model gives a box
    // the size of the nib, which is what makes it round (pen.dot).
    commit(d.moved ? d.points : d.points.slice(0, 1));
  }, [commit]);

  /**
   * The path has reached the length one stroke may hold. Finish it, and carry on from the point
   * it ended on: two strokes whose ends coincide draw one continuous line, which is the only way
   * a limit that is invisible to the hand can be honest (pen.long_stroke).
   */
  const split = useCallback(() => {
    const d = draw.current;
    if (!d) return;
    commit(d.points);
    const last = d.points[d.points.length - 1]!;
    const lastScreen = d.screen[d.screen.length - 1]!;
    draw.current = {
      pointerId: d.pointerId,
      start: lastScreen,
      // The press as a whole has plainly moved: a continuation is never collapsed back into a
      // dot because the hand happened to stop a moment later.
      moved: true,
      points: [last],
      screen: [lastScreen],
    };
  }, [commit]);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const d = draw.current;
      if (!d || e.pointerId !== d.pointerId) return;
      for (const point of batch(e)) {
        const screen = localPoint(live.current.surface, point);
        record(d, screen, screenToWorld(live.current.camera, screen));
      }
      // Checked after the burst rather than during it: one frame can carry enough points to
      // walk past the limit, and the part that is committed then holds a few more than the
      // limit before it is thinned back under it by the smoothing.
      if (d.points.length >= STROKE_MAX_POINTS) split();
      // Painted after the split rather than before it: the stroke that was just written is on
      // the board now, and the preview's job is only the part of the path that is not.
      schedulePaint();
    },
    [schedulePaint, split],
  );

  useWindowPointer({ onMove, onUp: finish, onCancel: finish });

  // The press paints its first point as soon as it begins. A press that has not moved yet has no
  // line to show, but painting the point it started at costs one path assignment, makes the pen
  // answer the press instead of the first move, and is what a dot-in-progress looks like.
  useEffect(() => {
    if (preview) paint();
  }, [preview, paint]);

  // The pen put down mid-press — Escape, or the rail — still hands over what was drawn, because
  // the rule this tool follows is that a press always becomes a stroke or nothing at all, and a
  // person who reaches for another tool has no interest in losing a line.
  useEffect(() => {
    if (!active || !canEdit) finish();
  }, [active, canEdit, finish]);

  // The wheel, while the pen is held. See point 3 of the header: the layer is what the pointer
  // is over, so the board's own listener on its own surface never hears it.
  useEffect(() => {
    const el = layerRef.current;
    if (!el || !active) return;
    const onWheel = (e: WheelEvent) => {
      // As on the board: over the board a wheel is the board's, so the page neither scrolls
      // nor zooms itself.
      e.preventDefault();
      onWheelInput(wheelInputFromEvent(live.current.surface, e));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [active, onWheelInput]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!active || !canEdit || e.button !== 0) return;
      // This press is a stroke: it neither pans the board, nor starts a marquee, nor pulls the
      // object underneath out from under the line about to be drawn over it (pen.navigation).
      e.stopPropagation();
      const screen = localPoint(live.current.surface, e);
      draw.current = {
        pointerId: e.pointerId,
        start: screen,
        moved: false,
        points: [screenToWorld(live.current.camera, screen)],
        screen: [screen],
      };
      setPreview(true);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [active, canEdit],
  );

  const nib = PEN_THICKNESS_WORLD[thickness];
  // The preview is a stroke in the same units the stroke is drawn in: world thickness scaled by
  // the zoom, which is what "the same line at the same size on the screen" means for a tool
  // whose nib is a board measurement.
  const previewWidth = Math.max(1, nib * camera.zoom);

  return (
    <div
      ref={layerRef}
      data-testid="pen-tool-layer"
      data-pen-drawing={preview ? 'true' : 'false'}
      className="tool-layer pen-tool-layer"
      aria-hidden="true"
      style={toolLayerStyle(active, penCursor(color, nib, camera.zoom))}
      onPointerDown={onPointerDown}
      onLostPointerCapture={finish}
      // Two quick clicks are two dots, not one dot plus a sticky note: story 9's
      // double-click-to-create has nothing to say while the pen is held.
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {preview ? (
        <svg
          data-testid="pen-preview"
          data-pen-preview="true"
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          <path
            ref={pathRef}
            data-testid="pen-preview-path"
            fill="none"
            stroke={PEN_COLORS[color]}
            strokeWidth={previewWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </div>
  );
}

/** Record one more point of the press. Split out because the loop over a burst is not a hook. */
function record(d: Draw, screen: Point, world: Point): void {
  if (
    !d.moved &&
    Math.hypot(screen.x - d.start.x, screen.y - d.start.y) >= DRAG_THRESHOLD_PX
  ) {
    d.moved = true;
  }
  d.points.push(world);
  d.screen.push(screen);
}
