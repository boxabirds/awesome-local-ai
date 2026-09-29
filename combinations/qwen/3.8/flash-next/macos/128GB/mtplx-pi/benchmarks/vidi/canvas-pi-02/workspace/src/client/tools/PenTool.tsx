/**
 * The pen tool (story 11, design §3.1, §4.5).
 *
 * A tool is only ever *active*, never armed: this component exists while the tool
 * is `pen` and does not exist otherwise, and the component boundary is what
 * discards a half-finished stroke when the person hits `v` or `esc` mid-draw — the
 * buffer is a ref inside the component, so unmounting it throws the drawing away
 * without any code having to say so.
 *
 * One gesture, one transaction per stroke: the pointer owns a gesture and a
 * gesture may commit several strokes (a long one is split at the point budget),
 * and each stroke goes into the document in its own transaction, because undo has
 * to be able to take one stroke back without taking the gesture's other strokes
 * with it (§4.1).
 *
 * The listeners live on the window for the length of the draw, not on the pen
 * component: `pen.options` says an option change mid-drag must not interrupt the
 * stroke, and a listener that dies with the component would do exactly that.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Camera } from '../canvas/camera';
import type { PenColor, PenThickness } from '../../shared/config';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import { strokeWidthWorld } from '../../shared/objects/stroke';
import {
  commitCapture,
  commitDot,
  beginCapture,
  extendCapture,
  localPoint,
  previewSnap,
} from './pen-capture';
import type { PenCapture } from './pen-capture';
import { StrokeShape } from '../objects/StrokeShape';
import { screenToWorld } from '../canvas/camera';

export interface PenToolProps {
  camera: Camera;
  doc: import('yjs').Doc;
  color: PenColor;
  thickness: PenThickness;
  /** Who is drawing, for `createdBy`. */
  by?: string;
  /** Called once per gesture with every stroke it committed. */
  onCommitted?(ids: string[]): void;
  /** Called when a gesture starts, so the board can open an undo group. */
  onGestureStart?(): void;
  /** Called when a gesture ends, committed or not. */
  onGestureEnd?(): void;
}

/**
 * The simplifier's tolerance in world units at the zoom being drawn at: one
 * screen pixel, whichever way the viewport is scaled. A line drawn while zoomed
 * in keeps its detail; the same line drawn at a quarter scale stays smooth
 * without turning into a polygon (`pen.smooth`).
 */
function simplifyTolerance(camera: Camera | undefined): number {
  return STROKE_SIMPLIFY_TOLERANCE_PX / Math.max(camera?.zoom ?? 1, 0.05);
}

/** Is this pointer event one that should draw? */function isDrawingPointer(event: PointerEvent): boolean {
  if (event.button !== 0) return false;
  // A right-button or middle-button press is navigation, and a trackpad's
  // three-finger swipe arrives as a non-primary pointer: neither draws.
  if (event.pointerType === 'mouse' && event.buttons !== 1) return false;
  return true;
}

export function PenTool(props: PenToolProps) {
  const { doc } = props;
  const propsRef = useRef(props);
  propsRef.current = props;

  /** The stroke under the pointer, or null when the pen is up. */
  const captureRef = useRef<PenCapture | null>(null);
  /**
   * How far the pointer has travelled since it came down, in **screen** pixels:
   * the distance that decides line or dot is a distance a person sees, not a
   * distance in the world, so it is measured before the zoom is divided out.
   */
  const travelRef = useRef(0);
  /** The last screen position the ink was sampled at, to measure that from. */
  const lastScreenRef = useRef<{ x: number; y: number } | null>(null);
  /** The viewport the pointer is tracked against. */
  const surfaceRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef(0);
  // A re-render is only a way to get the preview repainted; the drawing itself
  // lives in `captureRef`, so a repaint and the data cannot disagree.
  const [, setRepaint] = useState(0);

  const repaint = useCallback(() => {
    if (frameRef.current !== 0) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      setRepaint((count) => count + 1);
    });
  }, []);

  const discard = useCallback(() => {
    if (frameRef.current !== 0) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    if (captureRef.current !== null) {
      captureRef.current = null;
      propsRef.current.onGestureEnd?.();
      setRepaint((count) => count + 1);
    }
  }, []);

  useEffect(() => {
    const surface = document.querySelector(
      '[data-testid="board-viewport"]',
    ) as HTMLElement | null;
    surfaceRef.current = surface;
    if (!surface) return undefined;

    /** Where the next stroke's first point goes, in world units. */
    const toWorld = (event: PointerEvent) => {
      const camera = propsRef.current.camera;
      const local = localPoint(surface, event);
      return { camera, local };
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (!isDrawingPointer(event)) return;
      // A second press while a stroke is in flight is a new stroke: the old one
      // is discarded, never committed, because a pen that is picked up again was
      // not finished with.
      if (captureRef.current !== null) discard();

      const { camera, local } = toWorld(event);
      const start = screenToWorld(camera, local);
      const capture = beginCapture(start.x, start.y);
      captureRef.current = capture;
      travelRef.current = 0;
      lastScreenRef.current = local;
      propsRef.current.onGestureStart?.();
      repaint();
      event.stopPropagation();
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent): void => {
      const capture = captureRef.current;
      if (capture === null) return;
      if (event.pointerId !== undefined && event.buttons === 0) {
        // The pointer came back without a button: the press ended somewhere the
        // board never heard about. Discard rather than draw on.
        discard();
        return;
      }
      const { camera } = toWorld(event);
      // A fast move arrives as one event carrying several true positions, and the
      // drawing is the difference between them: a pen moved quickly leaves corners
      // in it if only the last position is taken. Where the platform does not
      // coalesce, the event's own position is the whole path.
      const samples =
        typeof event.getCoalescedEvents === 'function'
          ? event.getCoalescedEvents()
          : [];
      const path = samples.length > 0 ? samples : [event];
      for (const sample of path) {
        const point = screenToWorld(camera, localPoint(surface, sample));
        extendCapture(capture, point.x, point.y);
        const last = lastScreenRef.current;
        if (last !== null) {
          travelRef.current += Math.hypot(
            sample.clientX - last.x,
            sample.clientY - last.y,
          );
        }
        lastScreenRef.current = { x: sample.clientX, y: sample.clientY };
      }
      repaint();
    };

    const finish = (commit: boolean) => {
      const capture = captureRef.current;
      if (capture === null) return;
      captureRef.current = null;
      const travelled = travelRef.current;
      travelRef.current = 0;
      lastScreenRef.current = null;
      const options = {
        color: propsRef.current.color,
        thickness: propsRef.current.thickness,
        by: propsRef.current.by ?? 'local',
        tolerance: simplifyTolerance(propsRef.current.camera),
      };
      // Under three pixels of travel there is no line to simplify, only a place
      // where the pen came down: that is a dot, and it is drawn as one (§4.5,
      // `pen.dot`). It sits under the press rather than under wherever the pointer
      // drifted to inside those three pixels, because that is where the aim was.
      const ids = commit
        ? travelled < DRAG_THRESHOLD_PX
          ? commitDot(propsRef.current.doc, capture.points[0]!, capture.points[1]!, options)
          : commitCapture(propsRef.current.doc, capture, options)
        : [];
      propsRef.current.onGestureEnd?.();
      if (ids.length > 0) propsRef.current.onCommitted?.(ids);
      setRepaint((count) => count + 1);
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (captureRef.current === null) return;
      const { camera, local } = toWorld(event);
      const point = screenToWorld(camera, local);
      // The last position is part of the stroke: a lift that is also a movement
      // would otherwise lose its end.
      extendCapture(captureRef.current, point.x, point.y);
      finish(true);
    };

    const onPointerCancel = (): void => {
      // A cancel is the platform taking the pointer away, not the person saying
      // "undo": a pen lifted in a hurry still drew what it drew, so the stroke
      // goes in with the points it has (§4.5, TC-11). Escape and a tool change
      // are the ways to say "throw it away", and they discard.
      finish(true);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (captureRef.current === null) return;
      discard();
      event.stopPropagation();
    };

    // `pointerdown` is taken in the capture phase, on the surface: the pen draws
    // over a note, a shape or another stroke, and a press that happens to land on
    // one of them is still a stroke, not a drag of the thing under it (§4.5).
    surface.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      surface.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown);
      if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      // Leaving the tool discards whatever was under the pointer (§4.5:
      // "switching tools mid-draw discards").
      captureRef.current = null;
    };
  }, [doc, discard, repaint]);

  // The pen's cursor: a round mark as wide as the ink, so the thickness chosen
  // can be seen before anything is drawn (design §4.5). A data URL cursor is the
  // one way to do that without a second element following the pointer around, and
  // a browser that will not take the URL keeps `crosshair`, which is a worse
  // cursor rather than a broken board.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    const zoom = Math.max(props.camera.zoom ?? 1, 0.25);
    const diameter = Math.max(
      6,
      Math.min(48, Math.round(strokeWidthWorld(props.thickness) * zoom + 2)),
    );
    const radius = diameter / 2;
    const stroke = (PEN_COLORS[props.color] ?? PEN_COLORS.black).toLowerCase();
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='${diameter}' height='${diameter}'>` +
      `<circle cx='${radius}' cy='${radius}' r='${Math.max(radius - 1, 1)}' fill='none' ` +
      `stroke='${stroke}' stroke-width='1'/></svg>`;
    surface.style.cursor =
      `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${radius} ${radius}, crosshair`;
    return () => {
      surface.style.cursor = '';
    };
  }, [props.thickness, props.color, props.camera.zoom]);

  const capture = captureRef.current;
  if (capture === null) return null;
  const snaps = previewSnap(
    capture,
    {
      color: props.color,
      thickness: props.thickness,
    },
    simplifyTolerance(props.camera),
  );
  if (snaps.length === 0) return null;

  return (
    <>
      {snaps.map((snap, index) => (
        <StrokeShape
          // The preview is keyed by its place in the gesture, not by content:
          // one stroke grows, it does not get replaced.
          key={`preview-${index}`}
          snap={snap}
          preview
        />
      ))}
    </>
  );
}
