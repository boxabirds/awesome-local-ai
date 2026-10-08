import React, { useRef, useCallback, useEffect } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { createStroke } from '@shared/objects/stroke';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '@shared/config';
import type { PenColor, PenThickness } from '@shared/config';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc | null;
  identityId: string;
  onBoundary?(): void;
}

/**
 * Pen tool component. Handles pointer capture, point recording, local preview,
 * and stroke commitment on release/cancel/max-points.
 */
export function PenTool({ camera, color, thickness, doc, identityId, onBoundary }: PenToolProps) {
  const pointsRef = useRef<Point[]>([]);
  const startPointRef = useRef<Point | null>(null);
  const svgPathRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const drawingRef = useRef(false);

  // ── Commit a stroke from the recorded points ───────────────────────
  const commitStroke = useCallback(() => {
    if (!drawingRef.current || !doc || !onBoundary) return;

    const pts = [...pointsRef.current];
    if (pts.length === 0) return;

    onBoundary();
    pointsRef.current = [];
    startPointRef.current = null;
    svgPathRef.current = null;
    drawingRef.current = false;

    const id = createStroke(doc, { points: pts, color, thickness }, identityId);
    // If invalid, preview was already cleared above silently
    return id;
  }, [doc, color, thickness, identityId, onBoundary]);

  // ── Pointer down ───────────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (e.button !== 0) return;

      const el = e.currentTarget as HTMLElement;
      try {
        el.setPointerCapture(e.pointerId);
      } catch { /* no-op */ }

      drawingRef.current = true;
      const wp = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      pointsRef.current = [wp];
      startPointRef.current = wp;
    },
    [camera],
  );

  // ── Pointer move ───────────────────────────────────────────────────
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drawingRef.current) return;
      const wp = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      pointsRef.current.push(wp);

      // Check max points — commit part and restart
      if (pointsRef.current.length >= STROKE_MAX_POINTS) {
        commitStroke();
        // Restart at last point for seamless join
        const lastPt = pointsRef.current[pointsRef.current.length - 1];
        pointsRef.current = [lastPt];
        startPointRef.current = lastPt;
        drawingRef.current = true; // keep drawing
      }
    },
    [camera, commitStroke],
  );

  // ── Pointer up / cancel / lost capture ─────────────────────────────
  const handlePointerUp = useCallback(() => {
    if (!drawingRef.current) return;
    commitStroke();
  }, [commitStroke]);

  const handlePointerCancel = useCallback(() => {
    if (!drawingRef.current) return;
    commitStroke();
  }, [commitStroke]);

  const handleLostPointerCapture = useCallback(() => {
    if (!drawingRef.current) return;
    commitStroke();
  }, [commitStroke]);

  // ── Compute SVG preview path ───────────────────────────────────────
  const computePreviewPath = useCallback((): string | null => {
    const pts = pointsRef.current;
    if (pts.length === 0) return null;
    if (pts.length === 1) {
      return `M ${pts[0].x} ${pts[0].y}`;
    }

    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      const midY = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q ${midX} ${midY} ${pts[i + 1].x} ${pts[i + 1].y}`;
    }
    return d;
  }, []);

  // ── Animation frame preview update ─────────────────────────────────
  useEffect(() => {
    if (!drawingRef.current) return;

    const tick = () => {
      const d = computePreviewPath();
      svgPathRef.current = d;
      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, [computePreviewPath]);

  // ── Render preview elements in world space ─────────────────────────
  const previewPath = svgPathRef.current;
  const startPt = startPointRef.current ?? { x: 0, y: 0 };
  const cursorR = PEN_THICKNESS_WORLD[thickness] / 2;

  return (
    <>
      {/* Preview stroke path */}
      {previewPath && (
        <path
          d={previewPath}
          stroke={PEN_COLORS[color]}
          strokeWidth={PEN_THICKNESS_WORLD[thickness]}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          style={{ position: 'absolute', pointerEvents: 'none' }}
        />
      )}
      {/* Single-point dot indicator while drawing */}
      {!previewPath && drawingRef.current && (
        <circle
          cx={startPt.x}
          cy={startPt.y}
          r={cursorR}
          fill="transparent"
          stroke={PEN_COLORS[color]}
          strokeWidth={PEN_THICKNESS_WORLD[thickness]}
          style={{ position: 'absolute', pointerEvents: 'none' }}
        />
      )}
    </>
  );
}
