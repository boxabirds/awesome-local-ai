/**
 * PenTool: captures coalesced pointer events, shows a local preview path,
 * and commits strokes on release/cancel/limit.
 *
 * The pen stays active after each stroke (unlike shape/connector tools).
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Point } from '../../shared/board-model';
import type { PenColor, PenThickness } from '../../shared/config';
import {
  PEN_THICKNESS_WORLD,
  PEN_COLORS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  DRAG_THRESHOLD_PX,
} from '../../shared/config';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import * as Y from 'yjs';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  canEdit: boolean;
  /** Undo boundary callback. */
  undoBoundary(): void;
}

export function PenTool(props: PenToolProps): JSX.Element | null {
  const { camera, color, thickness, doc, identityId, canEdit, undoBoundary } = props;

  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const pointerId = useRef<number | null>(null);
  const rawPoints = useRef<Point[]>([]);
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
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const undoBoundaryRef = useRef(undoBoundary);
  undoBoundaryRef.current = undoBoundary;

  // Use rAF to update preview at most once per frame
  const rafPending = useRef(false);
  const schedulePreview = useCallback(() => {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      if (rawPoints.current.length > 0) {
        // Convert world points to screen for preview
        const cam = cameraRef.current;
        const screenPts = rawPoints.current.map((p) => ({
          x: (p.x - cam.x) * cam.zoom,
          y: (p.y - cam.y) * cam.zoom,
        }));
        setPreviewPath(smoothPath(screenPts));
      } else {
        setPreviewPath(null);
      }
    });
  }, []);

  const commitStroke = useCallback((points: readonly Point[]) => {
    if (!canEditRef.current) return;
    if (points.length === 0) return;

    const cam = cameraRef.current;
    let toCommit: Point[];

    if (points.length === 1) {
      // Single point: dot
      toCommit = [points[0]];
    } else {
      // Simplify with tolerance scaled by zoom
      const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / cam.zoom;
      toCommit = simplify(points, tolerance);
      if (toCommit.length === 0) return;
    }

    undoBoundaryRef.current();
    createStroke(docRef.current, {
      points: toCommit,
      color: colorRef.current,
      thickness: thicknessRef.current,
    }, identityIdRef.current);
    undoBoundaryRef.current();
  }, []);

  const handlePointerDown = useCallback((event: PointerEvent) => {
    if (pointerId.current !== null) return;
    // Only capture events on the board surface
    const target = event.target as HTMLElement;
    if (target.closest('[data-board-surface]') === null) return;

    pointerId.current = event.pointerId;
    const world = screenToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });
    rawPoints.current = [world];
    schedulePreview();

    event.preventDefault();
    event.stopPropagation();
  }, [schedulePreview]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (pointerId.current !== event.pointerId) return;

    // Use coalesced events if available (fall back to [event] for jsdom where
    // getCoalescedEvents() exists but returns [])
    const coalesced = typeof event.getCoalescedEvents === 'function'
      ? event.getCoalescedEvents()
      : [event];
    const events = coalesced.length > 0 ? coalesced : [event];

    for (const e of events) {
      const world = screenToWorld(cameraRef.current, { x: e.clientX, y: e.clientY });
      rawPoints.current.push(world);
    }

    // Check STROKE_MAX_POINTS limit
    if (rawPoints.current.length >= STROKE_MAX_POINTS) {
      // Commit this part
      commitStroke(rawPoints.current);
      // Restart from the last point
      const lastPoint = rawPoints.current[rawPoints.current.length - 1];
      rawPoints.current = [lastPoint];
    }

    schedulePreview();
  }, [commitStroke, schedulePreview]);

  const handlePointerUp = useCallback((event: PointerEvent) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;

    const points = rawPoints.current;
    rawPoints.current = [];
    setPreviewPath(null);

    if (points.length === 0) return;

    // Check if it was just a click (minimal movement)
    if (points.length <= 2) {
      const cam = cameraRef.current;
      const start = points[0];
      const end = points[points.length - 1];
      const screenDist = Math.hypot(
        (end.x - start.x) * cam.zoom,
        (end.y - start.y) * cam.zoom,
      );
      if (screenDist < DRAG_THRESHOLD_PX) {
        // Commit as a dot
        commitStroke([start]);
        return;
      }
    }

    commitStroke(points);
  }, [commitStroke]);

  const handlePointerCancel = useCallback((event: PointerEvent) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;

    const points = rawPoints.current;
    rawPoints.current = [];
    setPreviewPath(null);

    // Interrupted: commit what we have
    if (points.length > 0) {
      commitStroke(points);
    }
  }, [commitStroke]);

  useEffect(() => {
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointercancel', handlePointerCancel, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
      document.removeEventListener('pointercancel', handlePointerCancel, true);
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel]);

  // Render preview SVG overlay
  const thicknessPx = PEN_THICKNESS_WORLD[thicknessRef.current] * camera.zoom;
  const strokeColor = PEN_COLORS[colorRef.current];

  if (!previewPath) return null;

  return (
    <svg
      data-testid="pen-preview-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      <path
        d={previewPath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={thicknessPx}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
