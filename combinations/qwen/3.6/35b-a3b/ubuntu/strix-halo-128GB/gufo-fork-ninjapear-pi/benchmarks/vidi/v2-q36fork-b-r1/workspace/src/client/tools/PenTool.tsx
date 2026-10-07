import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import * as Y from 'yjs';
import { screenToWorld, Camera } from '@/client/canvas/camera';
import { createStrokeSimplified } from '@/shared/objects/stroke';
import type { Point } from '@/shared/geometry/types';
import { PEN_COLORS, PEN_THICKNESS_WORLD, DRAG_THRESHOLD_PX, STROKE_MAX_POINTS } from '@/shared/config';
import type { PenColor, PenThickness } from '@/shared/config';
import { smoothPath } from '@/shared/geometry/simplify';
import { LOCAL_ORIGIN } from '@/shared/board-model';

interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  zoom: number;
  onCreated(): void; // callback when stroke is committed
}

/** Render the pen drawing overlay in the world layer. */
export function PenTool(props: PenToolProps): ReactNode {
  const { camera, color, thickness, doc, identityId, onCreated } = props;

  const [rawPoints, setRawPoints] = useState<Point[]>([]);
  const [previewPath, setPreviewPath] = useState<string>('');
  const [isDrawing, setIsDrawing] = useState(false);

  const rafRef = useRef<number>(0);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const hasDraggedRef = useRef(false);
  const startWorldRef = useRef<Point | null>(null);

  // Draw preview at requestAnimationFrame rate
  const scheduleRedraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (rawPoints.length >= 2) {
        setPreviewPath(smoothPath(rawPoints));
      } else if (rawPoints.length === 1) {
        // Single point — render as dot via path
        setPreviewPath(`M ${rawPoints[0].x} ${rawPoints[0].y}`);
      } else {
        setPreviewPath('');
      }
    });
  }, [rawPoints]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      const wp = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      startWorldRef.current = wp;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      hasDraggedRef.current = false;
      setRawPoints([wp]);
      setIsDrawing(true);
      setPreviewPath('');
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [camera],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing) return;

      const curWorld = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      const prevCur = lastPointerRef.current;

      // Check drag threshold against previous cursor position
      if (prevCur) {
        const dx = e.clientX - prevCur.x;
        const dy = e.clientY - prevCur.y;
        if (dx * dx + dy * dy > DRAG_THRESHOLD_PX ** 2) {
          hasDraggedRef.current = true;
        }
      }

      lastPointerRef.current = { x: e.clientX, y: e.clientY };

      // Get coalesced points when available
      const event = e as unknown as PointerEvent;
      let newPoints: Point[] = [];
      if (event.getCoalescedEvents) {
        const events = event.getCoalescedEvents();
        for (const ev of events) {
          newPoints.push(screenToWorld(camera, { x: ev.clientX, y: ev.clientY }));
        }
      } else {
        newPoints.push(curWorld);
      }

      if (newPoints.length === 0) return;

      setRawPoints((prev) => [...prev, ...newPoints]);
      scheduleRedraw();
    },
    [camera, isDrawing, scheduleRedraw],
  );

  const commitStroke = useCallback(() => {
    if (!isDrawing || !startWorldRef.current) return;

    const currentPoints = rawPoints;

    // If nothing moved (click), create a single-point dot
    if (!hasDraggedRef.current || currentPoints.length < 2) {
      const dotPoint = currentPoints[currentPoints.length - 1];
      if (dotPoint && isFinite(dotPoint.x) && isFinite(dotPoint.y)) {
        const id = createStrokeSimplified(doc, [dotPoint], color, thickness, identityId, camera.zoom);
        if (id) {
          onCreated();
        }
      }
    } else {
      // Regular stroke: simplify and commit
      const id = createStrokeSimplified(doc, currentPoints, color, thickness, identityId, camera.zoom);
      if (id) {
        onCreated();
      }
    }

    setRawPoints([]);
    setPreviewPath('');
    setIsDrawing(false);
    hasDraggedRef.current = false;
    startWorldRef.current = null;
  }, [isDrawing, rawPoints, color, thickness, identityId, camera.zoom, doc, onCreated]);

  const handlePointerUpOrCancel = useCallback(() => {
    if (!isDrawing) return;
    commitStroke();
  }, [isDrawing, commitStroke]);

  // Handle pointercancel (system interruption) — commit what we have
  useEffect(() => {
    const el = (document.activeElement as HTMLElement)?.closest('[data-testid="board-viewport"]')?.querySelector('[data-layer="world"]');
    // We rely on pointer events bubbling to this component's SVG group
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Convert preview path to stroke-width scaled coordinates
  const strokeWidth = PEN_THICKNESS_WORLD[thickness] / camera.zoom;
  const cursorSize = PEN_THICKNESS_WORLD[thickness];

  return (
    <g
      data-testid="pen-tool-layer"
      style={{ transformOrigin: '0 0', transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      onLostPointerCapture={handlePointerUpOrCancel}
      pointerEvents="all"
    >
      {/* Preview path */}
      {previewPath && (
        <path
          data-testid="pen-preview"
          d={previewPath}
          stroke={PEN_COLORS[color]}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}

      {/* Round cursor indicator at mouse position (only when capturing) */}
      {isDrawing && lastPointerRef.current && (
        <circle
          cx={lastPointerRef.current.x}
          cy={lastPointerRef.current.y}
          r={cursorSize / 2}
          fill="none"
          stroke={PEN_COLORS[color]}
          strokeWidth={0.5}
          opacity={0.6}
        />
      )}
    </g>
  );
}
