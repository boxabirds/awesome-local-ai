/**
 * The Pen tool: the surface a stroke is drawn on (`pen.draw`).
 *
 * Like the Shape and Connector tools before it, this is an overlay rather than a behaviour
 * bolted onto the viewport. While the pen is held the pointer belongs to the pen: every point on
 * the board is a place to start a line, including a point in the middle of a sticky note
 * (`pen.navigation`, TC-19), and the alternative — teaching every object type to step aside —
 * would leave a rule to remember in each one.
 *
 * What happens to a gesture:
 *
 *  - **press, move, release** draws a line. Every pointer sample is taken, coalesced events and
 *    all, because a fast hand is exactly when the extra points matter; the preview is repainted
 *    once per animation frame rather than once per event, which is the difference between a line
 *    that follows the pointer and a board that stutters (`pen.draw`).
 *  - **nothing of it leaves this tab.** The preview is a screen-space overlay, never the
 *    document: what colleagues receive is one finished stroke in one transaction, and the
 *    half-drawn line they never see is the reason a shared board does not fill up with other
 *    people's milliseconds (`pen.share`).
 *  - **release, and the pen stays in hand** (`pen.stay_active`). A sketch is several strokes, and
 *    a tool that went back to Select after each one would make every drawing a search for the
 *    toolbar. Escape, or another tool, is what puts it down — and an unfinished drag that ends
 *    that way writes nothing, because the component holding it is gone.
 *  - **a pointer taken away is not a stroke thrown away** (`pen.interrupted`). A system cancel, or
 *    the capture being lost mid-draw, finishes the line with the points already drawn rather than
 *    losing the thing somebody just drew.
 *  - **a click is a dot** (`pen.dot`): below the drag threshold, the point that was pressed is
 *    committed on its own and drawn, round-capped, as a dot of the thickness.
 *  - **a line too long to hold is split** (`pen.long_stroke`): at `STROKE_MAX_POINTS` the part in
 *    hand is committed and the drawing continues from its last point, which both parts contain,
 *    so the two join with no gap and no overlap.
 *
 * The commit itself is the model's decision, not this component's: the points are simplified at a
 * tolerance derived from the zoom it was drawn at (`pen.smooth`) and handed to `createStroke`,
 * which answers `null` — and silently — for a line it cannot hold.
 */

import { useCallback, useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type { Doc } from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { polylinePath } from '../../shared/geometry/connector-geometry';
import { simplify, splitPoints } from '../../shared/geometry/simplify';
import { createStroke, type PenColor, type PenThickness } from '../../shared/objects/stroke';
import { screenToWorld, type Camera } from '../canvas/camera';
import { wheelDeltaToPixels } from '../canvas/BoardViewport';
import { useCameraContext } from '../canvas/useCamera';
import { useUndoController } from '../board/useUndo';

export interface PenToolProps {
  doc: Doc;
  camera: Camera;
  /** The colour and thickness picked on the pen toolbar (`pen.options`). */
  color: PenColor;
  thickness: PenThickness;
  /** Whose pen this is, recorded on the stroke when the board knows. Empty when it does not. */
  identityId: string;
  /** False while the board cannot be written to (story 4). The tool is not offered then. */
  canEdit?: boolean;
}

/** What one animation frame of the preview shows. */
interface Preview {
  /** The line so far, in this surface's own screen coordinates. Empty when nothing is drawn. */
  path: string;
  /** Where the pointer last was, for the round cursor (`pen.draw`'s "small round cursor"). */
  cursor: Point | null;
  /** Is a stroke being drawn right now? */
  drawing: boolean;
}

const IDLE: Preview = { path: '', cursor: null, drawing: false };

/** Every pointer sample of one event: the coalesced ones, and the event itself if it adds a point. */
function samplesOf(event: ReactPointerEvent<HTMLDivElement>): { clientX: number; clientY: number }[] {
  // A browser that batches pointer moves hands over the whole batch, so a fast stroke keeps the
  // shape of the hand rather than only its endpoints. jsdom has no such method, and a test that
  // fires one move at a time gets exactly the point it fired.
  const coalesced =
    typeof (event as { getCoalescedEvents?: () => { clientX: number; clientY: number }[] }).getCoalescedEvents ===
    'function'
      ? (event as unknown as { getCoalescedEvents(): { clientX: number; clientY: number }[] }).getCoalescedEvents()
      : [];
  const samples = coalesced.filter((sample) => Number.isFinite(sample?.clientX) && Number.isFinite(sample?.clientY));
  const last = samples[samples.length - 1];
  // Whether the current event is already the tail of the batch differs between browsers; taking
  // it when it is not is the difference between a faithful line and one that stops short.
  if (!last || last.clientX !== event.clientX || last.clientY !== event.clientY) {
    samples.push({ clientX: event.clientX, clientY: event.clientY });
  }
  return samples;
}

export function PenTool(props: PenToolProps): JSX.Element {
  const [preview, setPreview] = useState<Preview>(IDLE);

  // Handlers created once read the current values through refs, so a drag that outlives a
  // re-render — the camera moved, the colour changed — still draws with the real ones.
  const cameraRef = useRef(props.camera);
  cameraRef.current = props.camera;
  const docRef = useRef(props.doc);
  docRef.current = props.doc;
  const colorRef = useRef(props.color);
  colorRef.current = props.color;
  const thicknessRef = useRef(props.thickness);
  thicknessRef.current = props.thickness;
  const identityRef = useRef(props.identityId);
  identityRef.current = props.identityId;
  const canEditRef = useRef(props.canEdit !== false);
  canEditRef.current = props.canEdit !== false;

  const undoController = useUndoController();
  const undoRef = useRef(undoController);
  undoRef.current = undoController;
  // Navigation, for the one gesture the pen does not hold (`pen.navigation`).
  const navigation = useCameraContext();
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;

  // The stroke in hand. Two arrays of the same length, because the preview and the stroke live in
  // different worlds: the screen points are what gets painted this frame, the board points are
  // what gets stored — and converting at the moment of capture, rather than at the end, is what
  // keeps a line true if the camera happens to move while the pen is down.
  const worldRef = useRef<Point[]>([]);
  const screenRef = useRef<Point[]>([]);
  // Where the press landed, and whether the pointer ever left it far enough to be a line.
  const originRef = useRef<Point | null>(null);
  const movedRef = useRef(false);
  const drawingRef = useRef(false);

  // The preview is painted at most once per frame, however many pointer events arrived.
  const framePending = useRef(false);
  const frameHandle = useRef(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<Point | null>(null);

  /** This surface's own coordinates: it covers the window, so they are the pointer's. */
  const localPoint = (clientX: number, clientY: number): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const thicknessPx = () => PEN_THICKNESS_WORLD[thicknessRef.current] * (cameraRef.current.zoom || 1);

  /** Paint what is in hand, on the next frame — unless a frame is already on its way. */
  const schedulePaint = useCallback(() => {
    if (framePending.current) return;
    framePending.current = true;
    frameHandle.current = requestAnimationFrame(() => {
      framePending.current = false;
      setPreview({ path: polylinePath(screenRef.current), cursor: cursorRef.current, drawing: drawingRef.current });
    });
  }, []);

  /**
   * Hand over the part in hand and start the next one from the same point (`pen.long_stroke`).
   *
   * `splitPoints` decides where the cut falls, and every part holds the point that joins it to the
   * next, so the strokes that arrive on the board read as one line with no gap in it. Each part is
   * committed whole, which is also what makes each part its own undo step — one stroke, one step.
   */
  const splitIfNeeded = useCallback(() => {
    if (worldRef.current.length < STROKE_MAX_POINTS) return;
    const parts = splitPoints(worldRef.current, STROKE_MAX_POINTS);
    const lastPart = parts[parts.length - 1] ?? [];
    const lastWorld = lastPart[lastPart.length - 1];
    const lastScreen = screenRef.current[screenRef.current.length - 1];
    for (const part of parts) {
      undoRef.current?.boundary();
      createStroke(
        docRef.current,
        { points: part, color: colorRef.current, thickness: thicknessRef.current },
        identityRef.current
      );
      undoRef.current?.boundary();
    }
    // The pen starts the next stroke on the point the last one ended at — in both worlds, so the
    // line on the screen carries on from where the line on the board stopped.
    worldRef.current = lastWorld ? [lastWorld] : [];
    screenRef.current = lastScreen ? [lastScreen] : [];
  }, []);

  /** Finish the line in hand: simplify it as a person would see it, and put it on the board. */
  const commitStroke = useCallback((points: readonly Point[]) => {
    if (points.length === 0 || !canEditRef.current) return;
    // The tolerance is a screen pixel, and a board unit is not a screen pixel: drawing at 200%
    // zoom simplifies twice as finely, because that is how far the eye was (`pen.smooth`).
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / (cameraRef.current.zoom || 1);
    const smoothed = points.length > 1 ? simplify(points, tolerance) : points;
    // One undo step per stroke, bounded either side so the stroke that follows it is its own too
    // (`undo.steps`, `pen.long_stroke`).
    undoRef.current?.boundary();
    createStroke(
      docRef.current,
      { points: smoothed, color: colorRef.current, thickness: thicknessRef.current },
      identityRef.current
    );
    undoRef.current?.boundary();
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !canEditRef.current) return;
    // The pen holds the pointer for the whole gesture: wandering off the edge of the window or
    // across an object keeps drawing rather than dropping the line.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.stopPropagation();
    const point = localPoint(event.clientX, event.clientY);
    originRef.current = point;
    movedRef.current = false;
    drawingRef.current = true;
    worldRef.current = [screenToWorld(cameraRef.current, point)];
    screenRef.current = [point];
    cursorRef.current = point;
    // Painted now rather than on the next frame: the dot under the pointer at the moment of the
    // press is the answer to "did the board hear me".
    setPreview({ path: polylinePath([point, point]), cursor: point, drawing: true });
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      for (const sample of samplesOf(event)) {
        const point = localPoint(sample.clientX, sample.clientY);
        cursorRef.current = point;
        if (!drawingRef.current) continue;
        worldRef.current.push(screenToWorld(cameraRef.current, point));
        screenRef.current.push(point);
        const origin = originRef.current;
        if (!movedRef.current && origin && Math.hypot(point.x - origin.x, point.y - origin.y) >= DRAG_THRESHOLD_PX) {
          movedRef.current = true;
        }
      }
      if (drawingRef.current) splitIfNeeded();
      // One repaint per frame, whichever of the two — a drag, or a pointer hovering with the pen
      // held — asked for it.
      schedulePaint();
    },
    [schedulePaint, splitIfNeeded]
  );

  /**
   * The gesture is over: put down what is in the pen.
   *
   * Called for a release, and for a pointer that was taken away (`pen.interrupted`) — in both
   * cases the line somebody drew is kept. A press that never travelled is a dot at the point it
   * was pressed (`pen.dot`), because that is the spot the person aimed at.
   */
  const finish = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const points = worldRef.current;
    worldRef.current = [];
    screenRef.current = [];
    originRef.current = null;
    const wasDot = !movedRef.current;
    movedRef.current = false;
    setPreview({ path: '', cursor: cursorRef.current, drawing: false });
    if (points.length === 0) return;
    commitStroke(wasDot ? [points[0]] : points);
  }, [commitStroke]);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      finish();
    },
    [finish]
  );

  const handleLostCapture = useCallback(() => {
    // A browser that took the pointer away is not a reason to lose a drawing. By the time this
    // follows an ordinary release the pen is already empty, and an empty one writes nothing.
    finish();
  }, [finish]);

  // Wheeling over the pen still navigates (`pen.navigation`): the pen holds the pointer, not the
  // camera. Attached by hand because React's onWheel is passive and `preventDefault` is needed for
  // the page never to scroll instead.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      navigationRef.current.wheel({
        deltaX: wheelDeltaToPixels(event.deltaX, event.deltaMode),
        deltaY: wheelDeltaToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: { x: event.clientX - rect.left, y: event.clientY - rect.top }
      });
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, []);

  // A pen put down mid-draw (Escape, another tool) keeps nothing: the component is gone, and with
  // it the only copy of the line. That is the same rule every other tool follows — an unmounted
  // gesture writes nothing — and the frame it had queued is cancelled with it.
  useEffect(
    () => () => {
      if (frameHandle.current) cancelAnimationFrame(frameHandle.current);
      framePending.current = false;
    },
    []
  );

  const hex = PEN_COLORS[props.color] ?? PEN_COLORS.black;
  const cursorSize = PEN_THICKNESS_WORLD[props.thickness] * (props.camera.zoom || 1);

  return (
    <div
      className="vidi6-pen-tool"
      ref={surfaceRef}
      data-vidi6="pen-tool"
      data-color={props.color}
      data-thickness={props.thickness}
      data-dragging={preview.drawing ? 'true' : 'false'}
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={finish}
      onLostPointerCapture={handleLostCapture}
    >
      {preview.drawing ? (
        // The line being drawn, in screen space: it is a promise about the pointer, and it is
        // never written anywhere anybody else can see (`pen.share`).
        <svg className="vidi6-pen-preview" data-vidi6="pen-preview" width="100%" height="100%">
          <path d={preview.path} fill="none" stroke={hex} strokeWidth={thicknessPx()} />
        </svg>
      ) : null}
      {preview.cursor ? (
        // The pointer, at the size the pen draws: the thickness is a board measurement, so the
        // circle grows as you zoom in on the paper.
        <div
          className="vidi6-pen-cursor"
          data-vidi6="pen-cursor"
          data-color={props.color}
          style={{
            left: preview.cursor.x,
            top: preview.cursor.y,
            width: cursorSize,
            height: cursorSize,
            background: hex
          }}
        />
      ) : null}
    </div>
  );
}
