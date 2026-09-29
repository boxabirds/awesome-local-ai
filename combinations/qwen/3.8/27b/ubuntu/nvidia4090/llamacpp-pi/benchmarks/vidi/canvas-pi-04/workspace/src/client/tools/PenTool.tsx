// Story 11: the Pen tool (anchors: pen.draw, pen.smooth, pen.dot,
// pen.stay_active, pen.navigation, pen.long_stroke, pen.interrupted).
//
// Rendered by App in the screen-space board overlay while the tool is `pen`:
//  - a press starts a stroke (the tools own the pointer via window listeners;
//    the viewport does not pan/marquee while drawingToolActive — pen.navigation);
//  - a screen-space SVG preview follows the pointer, updated once per
//    animation frame (pen.draw). The preview is NEVER written to the Y.Doc,
//    so other clients see a stroke only when it is finished (pen.share);
//  - a release commits: a press that did not travel is a round dot (pen.dot),
//    otherwise the points are RDP-simplified (pen.smooth) and created;
//  - at STROKE_MAX_POINTS the part is committed and drawing restarts from its
//    last point, so very long strokes join seamlessly (pen.long_stroke);
//  - pointercancel / lostpointercapture commit the points so far (pen.
//    interrupted);
//  - the tool stays `pen` after each stroke (pen.stay_active); Escape or
//    another tool shortcut switches it (wired in useBoardKeys).
//
// The component commits straight through the model (createStroke) — it knows
// the points, colour and thickness — and records an undo boundary per commit
// (each finished stroke, and each part of a split stroke, is one step).

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { createStroke } from '../../shared/objects/stroke';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { useUndoController } from '../board/useUndo';

interface Preview {
  /** SVG path `d` in screen coordinates. */
  d: string;
  color: string;
  /** Stroke width in screen px (thickness * zoom). */
  width: number;
}

export function PenTool(props: {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
}): JSX.Element {
  const { camera } = props;
  const undo = useUndoController();

  // The live props change every render; the window listeners (mounted once)
  // read them through refs so a pan/zoom or option change mid-drag still
  // converts and commits with the current values.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const docRef = useRef(props.doc);
  docRef.current = props.doc;
  const colorRef = useRef(props.color);
  colorRef.current = props.color;
  const thicknessRef = useRef(props.thickness);
  thicknessRef.current = props.thickness;
  const identityRef = useRef(props.identityId);
  identityRef.current = props.identityId;
  const undoRef = useRef(undo);
  undoRef.current = undo;

  // The in-progress stroke part (world points) and its press origin.
  const pointsRef = useRef<Point[]>([]);
  const pointerIdRef = useRef<number | null>(null);
  // The last pointer screen position (drives the round cursor).
  const cursorRef = useRef<Point | null>(null);

  const [cursor, setCursor] = useState<Point | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const viewportRect = (): DOMRect | null => {
      const root = document.querySelector('[data-testid="board-viewport"]');
      return root === null ? null : root.getBoundingClientRect();
    };
    // Viewport-local screen point, or null outside the viewport (jsdom reports
    // a zero-sized rect, which we treat as "inside").
    const toLocal = (clientX: number, clientY: number): Point | null => {
      const rect = viewportRect();
      if (rect === null) return null;
      const inside =
        rect.width === 0 && rect.height === 0
          ? true
          : clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      if (!inside) return null;
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    const toWorld = (clientX: number, clientY: number): Point | null => {
      const local = toLocal(clientX, clientY);
      if (local === null) return null;
      return screenToWorld(cameraRef.current, local);
    };

    // Render the cursor and (while drawing) the preview from the refs. Called
    // at most once per animation frame, so drawing keeps up with the pointer
    // without flooding React (pen.draw: at least once per displayed frame).
    const paint = (): void => {
      const cam = cameraRef.current;
      setCursor(cursorRef.current === null ? null : { x: cursorRef.current.x, y: cursorRef.current.y });
      const pts = pointsRef.current;
      if (pts.length === 0) {
        setPreview(null);
        return;
      }
      // The preview tracks the raw input faithfully (the commit is what
      // simplifies); the points are converted to screen space for the path.
      const screenPts = pts.map((p) => worldToScreen(cam, p));
      setPreview({
        d: smoothPath(screenPts),
        color: PEN_COLORS[colorRef.current],
        width: PEN_THICKNESS_WORLD[thicknessRef.current] * cam.zoom,
      });
    };
    const schedule = (): void => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        paint();
      });
    };

    const appendPoint = (p: Point | null): void => {
      if (p === null) return;
      pointsRef.current.push(p);
    };

    const commitStroke = (points: Point[]): void => {
      if (points.length === 0) return;
      undoRef.current?.boundary();
      // A null result (invalid input) is discarded silently (error paths).
      createStroke(
        docRef.current,
        { points, color: colorRef.current, thickness: thicknessRef.current },
        identityRef.current,
      );
      undoRef.current?.boundary();
    };

    // Commit the in-progress part and restart from its last point so the next
    // part joins seamlessly (pen.long_stroke). RDP keeps the last point, so
    // the join is exact.
    const commitPartAndRestart = (): void => {
      const pts = pointsRef.current;
      if (pts.length === 0) return;
      // Smooth the part (pen.smooth): tolerance in screen px at this zoom.
      const simplified = simplify(pts, STROKE_SIMPLIFY_TOLERANCE_PX / cameraRef.current.zoom);
      commitStroke(simplified);
      const last = pts[pts.length - 1];
      pointsRef.current = [last];
    };

    const onDown = (e: PointerEvent): void => {
      if (pointerIdRef.current !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const root = document.querySelector('[data-testid="board-viewport"]');
      if (root === null || !root.contains(e.target as Node)) return;
      const local = toLocal(e.clientX, e.clientY);
      if (local === null) return;
      const world = screenToWorld(cameraRef.current, local);
      pointerIdRef.current = e.pointerId;
      pointsRef.current = [world];
      cursorRef.current = { x: local.x, y: local.y };
      // Capture so a lost capture / cancel tells us the drag was cut short
      // (pen.interrupted). jsdom lacks capture; the window listeners still
      // deliver the rest, and pointercancel is handled below.
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // Capture unavailable (jsdom): the drag still works.
      }
      schedule();
    };

    const onMove = (e: PointerEvent): void => {
      const local = toLocal(e.clientX, e.clientY);
      if (local !== null) cursorRef.current = { x: local.x, y: local.y };
      if (pointerIdRef.current !== e.pointerId) {
        // Not drawing: still track the cursor (the round pen cursor follows
        // the pointer even before a press).
        schedule();
        return;
      }
      // Coalesced events carry every sample the pointer produced, so a fast
      // drag is not dropped (pen.draw responsiveness).
      const coalesced: PointerEvent[] =
        typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      if (coalesced.length > 0) {
        for (const ev of coalesced) appendPoint(toWorld(ev.clientX, ev.clientY));
      } else {
        appendPoint(toWorld(e.clientX, e.clientY));
      }
      if (pointsRef.current.length >= STROKE_MAX_POINTS) commitPartAndRestart();
      schedule();
    };

    const finish = (e: PointerEvent, interrupted: boolean): void => {
      if (pointerIdRef.current !== e.pointerId) return;
      pointerIdRef.current = null;
      const pts = pointsRef.current;
      if (pts.length === 0) {
        setPreview(null);
        return;
      }
      // A press that did not travel is a round dot (pen.dot). Use the TOTAL
      // distance travelled (not start-to-end) so a closed loop, whose first
      // and last points coincide, is not mistaken for a click. An
      // interruption always keeps the points drawn so far (pen.interrupted).
      let travelled = 0;
      for (let i = 1; i < pts.length; i++) {
        travelled += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
      }
      if (!interrupted && travelled * cameraRef.current.zoom <= DRAG_THRESHOLD_PX) {
        commitStroke([pts[0]]);
        pointsRef.current = [];
        setPreview(null);
        return;
      }
      commitPartAndRestart();
      pointsRef.current = [];
      setPreview(null);
    };

    const onUp = (e: PointerEvent): void => finish(e, false);
    const onCancel = (e: PointerEvent): void => finish(e, true);

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('lostpointercapture', onCancel);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('lostpointercapture', onCancel);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // The listeners are mounted once and read the live props through refs.
  }, []);

  const thicknessPx = PEN_THICKNESS_WORLD[props.thickness] * camera.zoom;

  return (
    <div className="pen-tool" data-testid="pen-tool">
      {preview !== null && (
        <svg className="pen-tool__preview" width="100%" height="100%">
          <path
            data-testid="pen-preview-path"
            d={preview.d}
            fill="none"
            stroke={preview.color}
            strokeWidth={preview.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {cursor !== null && (
        <div
          className="pen-tool__cursor"
          data-testid="pen-cursor"
          style={{
            left: cursor.x - thicknessPx / 2,
            top: cursor.y - thicknessPx / 2,
            width: thicknessPx,
            height: thicknessPx,
            borderColor: PEN_COLORS[props.color],
          }}
        />
      )}
    </div>
  );
}
