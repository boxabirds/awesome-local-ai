/**
 * The Pen (story 11): draw freehand, and every stroke that is finished becomes an object.
 *
 * Like the Shape and Connector tools the Pen covers the board with a surface of its own, which is what
 * "the tool owns the pointer" means here too: a drag that begins on top of a note sketches over the
 * note rather than moving it, panning the board or starting a marquee.
 *
 * Two things about a pen make it different from the tools that came before it, and they pull in
 * opposite directions:
 *
 *  * A stroke is being drawn *now*, at the frame rate, with thousands of samples on a long drag. So the
 *    points live in a ref, the preview path is written straight into the DOM once per animation frame,
 *    and React is not asked to re-render anything between the first sample and the last. The preview is
 *    a local overlay: nobody else on the board sees a stroke while it is being drawn (`pen.share`).
 *  * A finished stroke is an ordinary board object, written once, in one `LOCAL_ORIGIN` transaction,
 *    as one undo step. That happens exactly twice in this file - when the pointer comes up (or is taken
 *    away: `pen.interrupted`), and when a drag runs past `STROKE_MAX_POINTS` (`pen.long_stroke`).
 *
 * The points are kept in world units, not screen pixels, so scrolling or zooming in the middle of a
 * stroke - the wheel still reaches the board, exactly as story 1 - keeps the line glued to the board it
 * is being drawn on instead of smearing across it.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import {
  DRAG_THRESHOLD_PX,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import { simplify, smoothPath, splitPoints } from '../../shared/geometry/simplify';
import { createStroke, penColorValue, type PenColor, type PenThickness } from '../../shared/objects/stroke';
import type { UndoController } from '../board/undo';
import type * as Y from 'yjs';

export interface PenToolProps {
  camera: Camera;
  /** The colour and thickness the next stroke is drawn with - session state, never the board's. */
  color: PenColor;
  thickness: PenThickness;
  /** The board this stroke is written to. */
  doc: Y.Doc;
  /** Who the stroke is attributed to. */
  identityId: string;
  /**
   * The story 8 history. A finished stroke is one step, so the capture window is closed after every
   * commit: the design's `undoManager.stopCapturing()`, in the words this codebase uses for it.
   */
  undo?: UndoController | null;
}

export function PenTool({
  camera,
  color,
  thickness,
  doc,
  identityId,
  undo = null,
}: PenToolProps): JSX.Element {
  // The stroke being drawn, in world units. A ref, because a drag can carry thousands of points and
  // React must not be involved in holding them.
  const pointsRef = useRef<Point[]>([]);
  // Where the pointer last was, in screen pixels, for the round cursor.
  const pointerRef = useRef<Point | null>(null);
  const drawingRef = useRef(false);
  // Whether the pointer ever got far enough from where it went down for this to be a line rather
  // than a dot, and where "down" was on the screen. Read once, at the end.
  const movedRef = useRef(false);
  const startScreenRef = useRef<Point>({ x: 0, y: 0 });
  const frameRef = useRef<number | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  // The camera as of the last render, for the handlers, which must not hold on to a stale one.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const optionsRef = useRef({ color, thickness });
  optionsRef.current = { color, thickness };

  // `drawing` only ever says whether to show the preview at all: one render on the way in, one on the
  // way out, none in between.
  const [drawing, setDrawing] = useState(false);
  const [hovering, setHovering] = useState(false);

  /** Writes the preview path and the cursor once per frame, whatever the pointer did meanwhile. */
  const paint = useCallback(() => {
    frameRef.current = null;
    const cam = cameraRef.current;
    const path = pathRef.current;
    if (path) {
      const screen = pointsRef.current.map((point) => worldToScreen(cam, point));
      path.setAttribute('d', smoothPath(screen));
    }
    const cursor = cursorRef.current;
    const at = pointerRef.current;
    if (cursor && at) {
      cursor.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)`;
    }
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(paint);
  }, [paint]);

  // A frame that was scheduled but never painted (the tool put down mid-drag) must not outlive it.
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  /**
   * Finishes a set of points: simplified to what the eye asked for (`pen.smooth`), then one stroke,
   * then one undo step. A stroke the model refuses - it cannot happen from a pointer, but a document
   * that has run out of room can - is dropped quietly, preview and all.
   */
  const commit = useCallback(
    (points: readonly Point[]) => {
      if (points.length === 0) return;
      const zoom = cameraRef.current.zoom > 0 ? cameraRef.current.zoom : 1;
      const { color: pen, thickness: width } = optionsRef.current;
      const simplified =
        points.length > 1 ? simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom) : points;
      createStroke(doc, { points: simplified, color: pen, thickness: width }, identityId);
      // one finished stroke is one step; the next one is another step, and so is the next
      undo?.boundary();
    },
    [doc, identityId, undo],
  );

  const endGesture = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const points = pointsRef.current;
    pointsRef.current = [];
    setDrawing(false);
    if (points.length === 0) return;
    // A press that never went anywhere is a dot (pen.dot): the first point, and nothing that jittered
    // inside a pixel of it. Committing the jitter instead would be a stroke of a dozen points that
    // simplifies back to a dot anyway - but only "anyway", and a dot is what was meant.
    commit(movedRef.current ? points : [points[0]!]);
  }, [commit]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return; // touch is out of scope (story 1)
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const start = screenToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });
    pointsRef.current = [start];
    pointerRef.current = { x: event.clientX, y: event.clientY };
    startScreenRef.current = { x: event.clientX, y: event.clientY };
    drawingRef.current = true;
    movedRef.current = false;
    setDrawing(true);
    schedule();
  };

  const append = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Everything the browser held on to since the last frame, not just the last of it: a fast drag
    // samples far more often than it fires, and the samples are the shape of the line.
    const coalesced =
      typeof event.nativeEvent.getCoalescedEvents === 'function'
        ? event.nativeEvent.getCoalescedEvents()
        : [];
    const samples =
      coalesced.length > 0
        ? coalesced.map((native) => ({ x: native.clientX, y: native.clientY }))
        : [{ x: event.clientX, y: event.clientY }];

    const points = pointsRef.current;
    for (const sample of samples) {
      points.push(screenToWorld(cameraRef.current, sample));
      pointerRef.current = sample;
      if (!movedRef.current) {
        const down = startScreenRef.current;
        if (Math.hypot(sample.x - down.x, sample.y - down.y) >= DRAG_THRESHOLD_PX) {
          movedRef.current = true;
        }
      }
    }

    // A drag that ran past the limit is committed in parts, each of which starts where the one before
    // it ended, so a line drawn for a minute is a minute of strokes with no gap in them (pen.long_stroke).
    const parts = splitPoints(points, STROKE_MAX_POINTS);
    if (parts.length > 1) {
      for (const part of parts.slice(0, -1)) commit(part);
      pointsRef.current = parts[parts.length - 1] ?? [];
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      schedule();
      return;
    }
    append(event);
    schedule();
  };

  /** The pen's own cursor: a circle the size the nib would be on the screen at this zoom. */
  const nib = Math.max(4, PEN_THICKNESS_WORLD[thickness] * camera.zoom);

  return (
    <div
      className="tool-surface"
      data-testid="pen-tool-surface"
      data-tool-kind="pen"
      data-drawing={drawing ? 'true' : 'false'}
      style={{ cursor: 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerEnter={(event) => {
        pointerRef.current = { x: event.clientX, y: event.clientY };
        setHovering(true);
      }}
      onPointerLeave={() => setHovering(false)}
      onPointerUp={() => {
        endGesture();
      }}
      onPointerCancel={endGesture}
      onLostPointerCapture={endGesture}
      onWheel={(event) => {
        // The tool sits over the board's own surface, so the wheel has to be handed down: scrolling
        // pans and Ctrl/Cmd+scroll zooms while the Pen is up, exactly as story 1 does it.
        const surface = document.querySelector('[data-board-surface]');
        if (surface instanceof Element) {
          surface.dispatchEvent(
            new WheelEvent('wheel', {
              deltaX: event.deltaX,
              deltaY: event.deltaY,
              deltaMode: event.deltaMode,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              clientX: event.clientX,
              clientY: event.clientY,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      }}
    >
      {/* The stroke being drawn: screen space, one path, rewritten once per frame. It is not part of
          the document, so nobody else can see it, and it goes away with the gesture that drew it. */}
      {drawing ? (
        <svg className="pen-tool__preview" data-testid="pen-preview" aria-hidden="true">
          <path
            ref={pathRef}
            data-testid="pen-preview-path"
            fill="none"
            stroke={penColorValue(color)}
            strokeWidth={PEN_THICKNESS_WORLD[thickness] * camera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {/* The nib, so the person can see the width they are drawing before they draw it. */}
      {hovering ? (
        <div
          ref={cursorRef}
          className="pen-tool__cursor"
          data-testid="pen-cursor"
          style={{
            width: nib,
            height: nib,
            borderColor: penColorValue(color),
            background: penColorValue(color),
            transform: `translate(${pointerRef.current?.x ?? 0}px, ${
              pointerRef.current?.y ?? 0
            }px) translate(-50%, -50%)`,
          }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
