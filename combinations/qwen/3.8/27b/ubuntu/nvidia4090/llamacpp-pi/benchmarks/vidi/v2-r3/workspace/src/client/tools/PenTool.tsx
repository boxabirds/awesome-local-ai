import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { smoothPath, simplify, splitPoints } from '../../shared/geometry/simplify';
import {
  createStroke,
  type PenColor,
  type PenThickness,
} from '../../shared/objects/stroke';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import type { UndoController } from '../board/undo';

/**
 * Story 11 (pen.tool): the Pen tool's screen-space layer.
 *
 * Press and drag captures the pointer, records the (simplified on commit)
 * world points and shows a local preview — the preview is NOT written to the
 * shared doc: a peer sees nothing until the stroke is finished. On release
 * the part drawn is committed (one undo step); a press-and-release with
 * movement below DRAG_THRESHOLD_PX commits a dot (a single point).
 * pointercancel / lostpointercapture keep the part drawn so far. When the
 * tool unmounts mid-gesture (Escape or a tool switch) the in-progress part
 * is dropped, mirroring story 10's "Escape cancels an in-progress draw".
 *
 * At STROKE_MAX_POINTS the part drawn so far is committed and the rest of
 * the gesture continues as the next stroke, starting from the last point
 * (so the pen appears to keep drawing). Each part is its own undo step.
 *
 * Wheel/trackpad events bubble to the viewport's native wheel handler, so
 * pan/zoom work while the pen is active; the layer itself only handles
 * primary-button pointer events.
 */
interface DrawState {
  pointerId: number;
  /** World points of the part currently being drawn (never written raw). */
  points: Point[];
  /** The press point in client coordinates (for the dot threshold). */
  startClient: Point;
  color: PenColor;
  thickness: PenThickness;
}

export function PenTool(props: {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  undo: UndoController;
}): ReactElement {
  const { camera, color, thickness, doc, identityId, undo } = props;
  const layerRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<DrawState | null>(null);
  const rafRef = useRef<number>(0); // 0: no preview frame pending
  const [preview, setPreview] = useState<DrawState | null>(null);

  // The tolerance is 1 screen pixel at the zoom the stroke is drawn with.
  const commitPart = (raw: Point[], d: DrawState) => {
    if (raw.length === 0) return;
    const tol = STROKE_SIMPLIFY_TOLERANCE_PX / camera.zoom;
    // One undo step per committed part (story 8): boundaries around the
    // single createStroke transaction, so consecutive parts (a split at
    // STROKE_MAX_POINTS) never merge into one step.
    undo.boundary();
    createStroke(doc, { points: simplify(raw, tol), color: d.color, thickness: d.thickness }, identityId);
    undo.boundary();
  };

  const clearPreview = () => {
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setPreview(null);
  };

  const schedulePreview = () => {
    if (rafRef.current !== 0) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const d = drawRef.current;
      setPreview(d ? { ...d, points: d.points.slice() } : null);
    });
  };

  /** Finish the gesture: below-threshold presses become a dot. */
  const finish = (client: Point) => {
    const d = drawRef.current;
    if (!d) return;
    drawRef.current = null;
    clearPreview();
    const moved = Math.hypot(client.x - d.startClient.x, client.y - d.startClient.y);
    commitPart(moved < DRAG_THRESHOLD_PX ? [d.points[0]] : d.points, d);
  };

  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const rect = layerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = layerRef.current;
    if (el && typeof el.setPointerCapture === 'function') el.setPointerCapture(e.pointerId);
    drawRef.current = {
      pointerId: e.pointerId,
      points: [screenToWorld(camera, toLocal(e))],
      startClient: { x: e.clientX, y: e.clientY },
      color,
      thickness,
    };
    schedulePreview();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drawRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const ne = e.nativeEvent;
    const coalesced: Array<{ clientX: number; clientY: number }> =
      typeof ne.getCoalescedEvents === 'function' ? ne.getCoalescedEvents() : [];
    const rect = layerRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    for (const ev of coalesced) {
      d.points.push(screenToWorld(camera, { x: ev.clientX - left, y: ev.clientY - top }));
    }
    // The current event is not in the coalesced list (spec) — append it.
    d.points.push(screenToWorld(camera, { x: e.clientX - left, y: e.clientY - top }));
    // Very long strokes: commit each full part live and restart the part at
    // its last point (splitPoints overlaps by exactly the join point).
    if (d.points.length >= STROKE_MAX_POINTS) {
      const parts = splitPoints(d.points);
      if (parts.length > 1) {
        for (const part of parts.slice(0, -1)) commitPart(part, d);
        d.points = parts[parts.length - 1];
      }
    }
    schedulePreview();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drawRef.current && e.pointerId === drawRef.current.pointerId) {
      finish({ x: e.clientX, y: e.clientY });
    }
  };

  // pointercancel / lostpointercapture: interrupted — keep the part drawn.
  const onPointerCancel = (e: React.PointerEvent) => {
    if (drawRef.current && e.pointerId === drawRef.current.pointerId) {
      finish({ x: e.clientX, y: e.clientY });
    }
  };
  const onLostPointerCapture = (e: React.PointerEvent) => {
    if (drawRef.current && e.pointerId === drawRef.current.pointerId) {
      finish({ x: e.clientX, y: e.clientY });
    }
  };

  // Unmount mid-gesture (Escape / tool switch): drop the in-progress part —
  // the same rule story 10 applies to in-progress shape draws.
  useEffect(
    () => () => {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
      drawRef.current = null;
    },
    [],
  );

  // The pointer becomes a small round cursor the size of the current
  // thickness (screen pixels at the current zoom).
  const radius = Math.max(1, Math.round((PEN_THICKNESS_WORLD[thickness] * camera.zoom) / 2));
  const cursorSvg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${radius * 2}' height='${radius * 2}'` +
    `<circle cx='${radius}' cy='${radius}' r='${Math.max(radius - 1, 0.75)}' fill='none' stroke='${PEN_COLORS[color]}' stroke-width='1.5'/>` +
    `</svg>`;

  const pv = preview;
  return (
    <div
      ref={layerRef}
      data-pen-tool-layer="true"
      style={{
        position: 'absolute',
        inset: 0,
        cursor: `url("data:image/svg+xml,${encodeURIComponent(cursorSvg)}") ${radius} ${radius}, crosshair`,
        zIndex: 15,
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
    >
      {pv && (
        <svg
          data-pen-preview-svg="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          <path
            data-pen-preview="true"
            d={smoothPath(pv.points.map((p) => worldToScreen(camera, p)))}
            fill="none"
            stroke={PEN_COLORS[pv.color]}
            strokeWidth={PEN_THICKNESS_WORLD[pv.thickness] * camera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
