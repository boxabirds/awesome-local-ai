import { useEffect, useRef, useCallback } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, type Camera } from '../canvas/camera';
import { simplify } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  DRAG_THRESHOLD_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  onCommit(): void;
}

/**
 * Pen tool: captures pointer events into a local preview overlay,
 * commits strokes on release/cancel/limit. Never writes in-progress data to the doc.
 */
export function PenTool({ camera, color, thickness, doc, identityId, onCommit }: PenToolProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointsRef = useRef<Point[]>([]);
  const rawCountRef = useRef(0);
  const drawingRef = useRef(false);
  const startScreenRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number>(0);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const colorRef = useRef(color);
  colorRef.current = color;
  const thicknessRef = useRef(thickness);
  thicknessRef.current = thickness;
  const docRef = useRef(doc);
  docRef.current = doc;
  const identityIdRef = useRef(identityId);
  identityIdRef.current = identityId;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const updatePreview = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const pts = pointsRef.current;
    if (pts.length === 0) return;

    const cam = cameraRef.current;
    // Convert world points to screen-space for the preview
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      const sx = (pts[i].x - cam.x) * cam.zoom;
      const sy = (pts[i].y - cam.y) * cam.zoom;
      if (i === 0) {
        d = `M ${sx} ${sy}`;
      } else {
        d += ` L ${sx} ${sy}`;
      }
    }

    let path = svg.querySelector('path[data-preview]');
    if (!path) {
      path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('data-preview', 'true');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
    }
    path.setAttribute('d', d);
    const tWorld = PEN_THICKNESS_WORLD[thicknessRef.current];
    path.setAttribute('stroke-width', String(tWorld * cam.zoom));
    path.setAttribute('stroke', `var(--pen-color, #212121)`);
  }, []);

  const schedulePreview = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(updatePreview);
  }, [updatePreview]);

  const commitStroke = useCallback((points: readonly Point[]) => {
    const cam = cameraRef.current;
    if (points.length === 0) return;

    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / cam.zoom;
    const simplified = points.length === 1 ? points : simplify(points, tolerance);

    const id = createStroke(docRef.current, {
      points: simplified,
      color: colorRef.current,
      thickness: thicknessRef.current,
    }, identityIdRef.current);

    if (id) {
      onCommitRef.current();
    }
  }, []);

  const commitPartAndRestart = useCallback(() => {
    const cam = cameraRef.current;
    const pts = pointsRef.current;
    if (pts.length < 2) return;

    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / cam.zoom;
    const simplified = simplify(pts, tolerance);

    createStroke(docRef.current, {
      points: simplified,
      color: colorRef.current,
      thickness: thicknessRef.current,
    }, identityIdRef.current);

    // Restart from the last point
    const last = pts[pts.length - 1];
    pointsRef.current = [{ ...last }];
    rawCountRef.current = 1;
    onCommitRef.current();
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = overlayRef.current;
    if (!el) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* jsdom */ }

    drawingRef.current = true;
    startScreenRef.current = { x: e.clientX, y: e.clientY };
    const cam = cameraRef.current;
    const rect = el.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = screenToWorld(cam, screen);
    pointsRef.current = [world];
    rawCountRef.current = 1;

    // Clear existing preview path
    const svg = svgRef.current;
    if (svg) {
      const existing = svg.querySelector('path[data-preview]');
      if (existing) existing.remove();
    }
    schedulePreview();
  }, [schedulePreview]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const el = overlayRef.current;
    if (!el) return;
    const cam = cameraRef.current;
    const rect = el.getBoundingClientRect();

    // Use coalesced events when available for higher fidelity
    const events = (e as any).getCoalescedEvents?.() as PointerEvent[] | undefined;
    const pointList = events && events.length > 0 ? events : [e];

    for (const pe of pointList) {
      const screen = { x: pe.clientX - rect.left, y: pe.clientY - rect.top };
      const world = screenToWorld(cam, screen);
      pointsRef.current.push(world);
      rawCountRef.current++;

      if (rawCountRef.current >= STROKE_MAX_POINTS) {
        commitPartAndRestart();
      }
    }

    schedulePreview();
  }, [schedulePreview, commitPartAndRestart]);

  const finishStroke = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const pts = pointsRef.current;

    // Clear preview
    const svg = svgRef.current;
    if (svg) {
      const existing = svg.querySelector('path[data-preview]');
      if (existing) existing.remove();
    }

    if (pts.length === 0) return;

    // Check if it's just a click (dot)
    const start = startScreenRef.current;
    if (start && pts.length === 1) {
      commitStroke(pts);
    } else if (pts.length > 1) {
      // Check movement distance
      const cam = cameraRef.current;
      const first = pts[0];
      const last = pts[pts.length - 1];
      const dx = (last.x - first.x) * cam.zoom;
      const dy = (last.y - first.y) * cam.zoom;
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
        // Treat as a dot
        commitStroke([pts[0]]);
      } else {
        commitStroke(pts);
      }
    }

    pointsRef.current = [];
    rawCountRef.current = 0;
    startScreenRef.current = null;
  }, [commitStroke]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    try { overlayRef.current?.releasePointerCapture(e.pointerId); } catch { /* */ }
    finishStroke();
  }, [finishStroke]);

  const handlePointerCancel = useCallback(() => {
    finishStroke();
  }, [finishStroke]);

  const handleLostPointerCapture = useCallback(() => {
    finishStroke();
  }, [finishStroke]);

  // Set colour CSS variable on the overlay
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    el.style.setProperty('--pen-color', PEN_COLORS[color]);
  }, [color]);

  const thicknessWorld = PEN_THICKNESS_WORLD[thickness];
  const cursorSize = Math.max(6, thicknessWorld * camera.zoom);

  return (
    <div
      ref={overlayRef}
      data-testid="pen-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        cursor: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='${Math.ceil(cursorSize)}' height='${Math.ceil(cursorSize)}'><circle cx='${cursorSize / 2}' cy='${cursorSize / 2}' r='${cursorSize / 2 - 0.5}' fill='%23212121'/></svg>") ${Math.round(cursorSize / 2)} ${Math.round(cursorSize / 2)}, crosshair`,
        touchAction: 'none',
        zIndex: 50,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
    >
      <svg
        ref={svgRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        data-testid="pen-preview-svg"
      />
    </div>
  );
}
