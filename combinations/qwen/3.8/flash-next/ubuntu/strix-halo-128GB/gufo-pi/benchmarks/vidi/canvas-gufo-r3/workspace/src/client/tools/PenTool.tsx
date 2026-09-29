import React, { useCallback, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '@client/canvas/camera';
import { screenToWorld } from '@client/canvas/camera';
import type { PenColor, PenThickness } from '@shared/config';
import {
  PEN_THICKNESS_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  DRAG_THRESHOLD_PX,
} from '@shared/config';
import { simplify } from '@shared/geometry/simplify';
import { createStroke } from '@shared/objects/stroke';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  /** Called after a commit so the host can call undoController.stopCapturing(). */
  onCommit?(): void;
  /** Wheel handler to forward navigation while pen is active. */
  wheel?(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }): void;
  /** Gesture zoom handler for pinch. */
  gestureZoom?(scale: number, point: Point): void;
}

interface DragState {
  points: Point[];
  screenStart: { x: number; y: number } | null;
}

/**
 * Full-viewport overlay while the Pen tool is active. Captures pointer events,
 * records coalesced world points, draws a screen-space SVG preview once per frame,
 * and commits a stroke on release / cancel / max points.
 */
export function PenTool(props: PenToolProps): React.ReactElement {
  const { camera, color, thickness, doc, identityId, onCommit, wheel, gestureZoom } = props;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [dragPreview, setDragPreview] = useState<Point[] | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number>(0);
  const previewDirty = useRef(false);
  const cameraRef = useRef<Camera>(camera);
  cameraRef.current = camera;
  const colorRef = useRef<PenColor>(color);
  colorRef.current = color;
  const thicknessRef = useRef<PenThickness>(thickness);
  thicknessRef.current = thickness;

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = rootRef.current?.getBoundingClientRect();
      const sx = clientX - (rect?.left ?? 0);
      const sy = clientY - (rect?.top ?? 0);
      return screenToWorld(cameraRef.current, { x: sx, y: sy });
    },
    [],
  );

  const commitStroke = useCallback(
    (pts: Point[]) => {
      if (pts.length === 0) return;
      const cam = cameraRef.current;
      const tol = STROKE_SIMPLIFY_TOLERANCE_PX / cam.zoom;
      let id: string | null;
      if (pts.length === 1) {
        id = createStroke(doc, { points: pts, color: colorRef.current, thickness: thicknessRef.current }, identityId);
      } else {
        const simplified = simplify(pts, tol);
        id = createStroke(doc, { points: simplified, color: colorRef.current, thickness: thicknessRef.current }, identityId);
      }
      onCommit?.();
      return id;
    },
    [doc, identityId, onCommit],
  );

  const commitPart = useCallback(
    (pts: Point[]) => {
      return commitStroke(pts);
    },
    [commitStroke],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);

      const world = toWorld(e.clientX, e.clientY);
      const state: DragState = {
        points: [world],
        screenStart: { x: e.clientX, y: e.clientY },
      };
      dragRef.current = state;
      setDragPreview([world]);

      const onMove = (ev: PointerEvent) => {
        const cur = dragRef.current;
        if (!cur) return;
        // Use coalesced events for higher fidelity
        const coalesced = typeof (ev as any).getCoalescedEvents === 'function'
          ? (ev as any).getCoalescedEvents() as PointerEvent[]
          : null;
        if (coalesced && coalesced.length > 0) {
          for (const ce of coalesced) {
            cur.points.push(toWorld(ce.clientX, ce.clientY));
          }
        } else {
          cur.points.push(toWorld(ev.clientX, ev.clientY));
        }

        // Check STROKE_MAX_POINTS threshold
        if (cur.points.length >= STROKE_MAX_POINTS) {
          commitPart(cur.points);
          // Restart with last point
          const lastPt = cur.points[cur.points.length - 1];
          cur.points = [lastPt];
        }

        previewDirty.current = true;
      };

      const onUp = (ev: PointerEvent) => {
        cleanup();
        const cur = dragRef.current;
        dragRef.current = null;
        setDragPreview(null);
        if (!cur) return;
        // Check if this is a click (no significant movement)
        const dx = ev.clientX - (cur.screenStart?.x ?? ev.clientX);
        const dy = ev.clientY - (cur.screenStart?.y ?? ev.clientY);
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
          // Dot: commit only the first point
          commitStroke([cur.points[0]]);
        } else {
          // Add final point
          cur.points.push(toWorld(ev.clientX, ev.clientY));
          commitStroke(cur.points);
        }
      };

      const onCancel = () => {
        cleanup();
        const cur = dragRef.current;
        dragRef.current = null;
        setDragPreview(null);
        if (!cur) return;
        // Commit with points so far
        commitStroke(cur.points);
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('lostpointercapture', onLostCapture);
      };

      const onLostCapture = () => {
        cleanup();
        const cur = dragRef.current;
        dragRef.current = null;
        setDragPreview(null);
        if (!cur) return;
        commitStroke(cur.points);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('lostpointercapture', onLostCapture);
    },
    [toWorld, commitStroke, commitPart],
  );

  // RAF loop for updating preview
  const [previewD, setPreviewD] = useState<string>('');
  const previewDRef = useRef<string>('');

  React.useEffect(() => {
    let active = true;
    function tick() {
      if (!active) return;
      if (previewDirty.current && dragRef.current && dragRef.current.points.length > 0) {
        previewDirty.current = false;
        const cam = cameraRef.current;
        const pts = dragRef.current.points;
        // Convert world points to screen-space SVG path
        const screenPts = pts.map((p) => ({
          x: (p.x - cam.x) * cam.zoom,
          y: (p.y - cam.y) * cam.zoom,
        }));
        // Build simple path
        let d = `M ${screenPts[0].x} ${screenPts[0].y}`;
        for (let i = 1; i < screenPts.length; i++) {
          d += ` L ${screenPts[i].x} ${screenPts[i].y}`;
        }
        previewDRef.current = d;
        setPreviewD(d);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Forward wheel events to the viewport's wheel handler
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || !wheel) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      let deltaX = e.deltaX;
      let deltaY = e.deltaY;
      const DELTA_MODE_LINE = 1;
      const DELTA_MODE_PAGE = 2;
      const LINE_HEIGHT = 16;
      const PAGE_HEIGHT = 800;
      if (e.deltaMode === DELTA_MODE_LINE) {
        deltaX *= LINE_HEIGHT;
        deltaY *= LINE_HEIGHT;
      } else if (e.deltaMode === DELTA_MODE_PAGE) {
        deltaX *= PAGE_HEIGHT;
        deltaY *= PAGE_HEIGHT;
      }
      const rect = el.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      wheel({ deltaX, deltaY, ctrlOrMeta: e.ctrlKey || e.metaKey, point });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [wheel]);

  const thicknessPx = PEN_THICKNESS_WORLD[thicknessRef.current] * camera.zoom;
  const colorHex = colorRef.current === 'black' ? '#212121'
    : colorRef.current === 'blue' ? '#1E88E5'
    : colorRef.current === 'red' ? '#E53935'
    : colorRef.current === 'green' ? '#43A047'
    : colorRef.current === 'orange' ? '#FB8C00'
    : colorRef.current === 'purple' ? '#8E24AA'
    : '#212121';

  // Round cursor style sized to thickness × zoom
  const cursorSize = Math.max(4, thicknessPx);

  return (
    <div
      ref={rootRef}
      data-testid="pen-tool-overlay"
      onPointerDown={handlePointerDown}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        cursor: `crosshair`,
        touchAction: 'none',
      }}
    >
      {previewD && dragRef.current && (
        <svg
          data-testid="pen-preview"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          <path
            d={previewD}
            fill="none"
            stroke={colorHex}
            strokeWidth={thicknessPx}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
