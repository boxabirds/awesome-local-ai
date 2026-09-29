// Pen tool (see spec: pen.capture): full-viewport screen-space overlay while
// the Pen tool is active.
//
// Capture:
//   pointerdown  — capture the pointer, start a stroke at the world point
//   pointermove  — append coalesced points; a screen-space SVG preview path
//                  (data-testid="pen-preview") is redrawn once per animation
//                  frame (rAF), with the pen cursor (a thickness-sized ring)
//   pointerup    — a click (movement < DRAG_THRESHOLD_PX on screen) becomes a
//                  one-point dot; otherwise the points are RDP-simplified at
//                  STROKE_SIMPLIFY_TOLERANCE_PX / zoom and committed
//   pointercancel / lostpointercapture — commit the points so far
//   STROKE_MAX_POINTS reached mid-capture — commit the part and start a new
//   one at the join point
//
// Every committed part is one undo step. The overlay never selects, moves
// or pans: it is a screen-space child of the BoardViewport, so wheel and
// gesture events still reach the viewport's camera handlers (TC-19).

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { smoothPath, simplify } from '../../shared/geometry/simplify';
import { createStroke, type PenColor, type PenThickness } from '../../shared/objects/stroke';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  undo?: { boundary(): void };
}

/** The Pen tool overlay (see spec: pen.capture). */
export function PenTool(props: PenToolProps): React.ReactElement {
  const { camera, color, thickness, doc, identityId, undo } = props;
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const pointsRef = useRef<Point[]>([]);
  const downRef = useRef<{ world: Point; screen: Point; pointerId: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  const cursorSize = Math.max(8, PEN_THICKNESS_WORLD[thickness] * camera.zoom);
  const strokeColor = PEN_COLORS[color];
  const previewWidth = PEN_THICKNESS_WORLD[thickness] * camera.zoom;

  const clientToLocal = useCallback(
    (clientX: number, clientY: number): Point => {
      const el = overlayRef.current;
      const rect = el === null ? null : el.getBoundingClientRect();
      return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
    },
    [],
  );

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => screenToWorld(camera, clientToLocal(clientX, clientY)),
    [camera, clientToLocal],
  );

  const redrawPreview = useCallback(() => {
    const pts = pointsRef.current;
    if (pts.length === 0) {
      setPreview(null);
      return;
    }
    setPreview(smoothPath(pts.map((p) => worldToScreen(camera, p))));
  }, [camera]);

  const schedulePreview = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      redrawPreview();
    });
  }, [redrawPreview]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  /** Cancel any pending rAF preview flush so it cannot re-set the preview after we clear it. */
  const cancelPreview = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /** Commit a list of world points as one stroke (one undo step). */
  const commit = useCallback(
    (points: readonly Point[]) => {
      if (points.length === 0) return;
      const simplified = simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / camera.zoom);
      const id = createStroke(doc, { points: simplified, color, thickness }, identityId);
      if (id !== null) undo?.boundary();
    },
    [camera.zoom, color, doc, identityId, thickness, undo],
  );

  /** Commit the current part (split at STROKE_MAX_POINTS) and restart it at
   *  the join point. */
  const commitPart = useCallback(() => {
    const pts = pointsRef.current;
    commit(pts);
    pointsRef.current = pts.length > 0 ? [pts[pts.length - 1]!] : [];
    schedulePreview();
  }, [commit, schedulePreview]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || downRef.current !== null) return;
    event.stopPropagation();
    const el = event.currentTarget;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // No capture in some test environments — moves still arrive.
    }
    const world = toWorld(event.clientX, event.clientY);
    downRef.current = { world, screen: clientToLocal(event.clientX, event.clientY), pointerId: event.pointerId };
    pointsRef.current = [world];
    setCursor(clientToLocal(event.clientX, event.clientY));
    schedulePreview();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const down = downRef.current;
    const local = clientToLocal(event.clientX, event.clientY);
    if (down === null || event.pointerId !== down.pointerId) {
      setCursor(local);
      return;
    }
    const native = event.nativeEvent as PointerEvent;
    const events: Array<{ clientX: number; clientY: number }> =
      typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length > 0
        ? native.getCoalescedEvents()
        : [native];
    for (const ev of events) {
      pointsRef.current.push(toWorld(ev.clientX, ev.clientY));
      if (pointsRef.current.length >= STROKE_MAX_POINTS) commitPart();
    }
    setCursor(local);
    schedulePreview();
  };

  const finish = (event: React.PointerEvent<HTMLDivElement>): void => {
    const down = downRef.current;
    if (down === null || event.pointerId !== down.pointerId) return;
    downRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Already released (or never captured).
    }
    const up = clientToLocal(event.clientX, event.clientY);
    if (Math.hypot(up.x - down.screen.x, up.y - down.screen.y) < DRAG_THRESHOLD_PX) {
      commit([down.world]); // a click is a dot
    } else {
      commitPart();
    }
    cancelPreview();
    setPreview(null);
  };

  const onCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    const down = downRef.current;
    if (down === null || event.pointerId !== down.pointerId) return;
    downRef.current = null;
    commitPart(); // the points so far become the stroke
    cancelPreview();
    setPreview(null);
  };

  const onLostPointerCapture = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (downRef.current === null || event.pointerId !== downRef.current.pointerId) return;
    downRef.current = null;
    commitPart();
    cancelPreview();
    setPreview(null);
  };

  const onPointerLeave = (): void => {
    if (downRef.current === null) setCursor(null);
  };

  return (
    <div
      ref={overlayRef}
      data-testid="pen-tool"
      className="pen-tool"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={onCancel}
      onLostPointerCapture={onLostPointerCapture}
      onPointerLeave={onPointerLeave}
    >
      {preview !== null && (
        <svg
          data-testid="pen-preview-svg"
          aria-hidden="true"
          className="pen-tool__preview"
          width="100%"
          height="100%"
        >
          <path
            data-testid="pen-preview"
            d={preview}
            fill="none"
            stroke={strokeColor}
            strokeWidth={previewWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {cursor !== null && (
        <div
          data-testid="pen-cursor"
          aria-hidden="true"
          className="pen-tool__cursor"
          style={{
            width: cursorSize,
            height: cursorSize,
            transform: `translate(${cursor.x - cursorSize / 2}px, ${cursor.y - cursorSize / 2}px)`,
            borderColor: strokeColor,
          }}
        />
      )}
    </div>
  );
}
