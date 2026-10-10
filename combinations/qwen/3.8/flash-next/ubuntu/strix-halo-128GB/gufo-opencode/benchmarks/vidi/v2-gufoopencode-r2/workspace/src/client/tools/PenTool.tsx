// Pen tool (Pen button or P): a drag captures every pointer move (including
// coalesced events), redraws the local preview once per animation frame and
// never touches the document, so nobody else sees the stroke while it is
// drawn. On release the points are RDP-simplified at
// STROKE_SIMPLIFY_TOLERANCE_PX / zoom (1 screen pixel at the drawing zoom)
// and committed as one stroke; a press with less than DRAG_THRESHOLD_PX
// movement commits a single-point dot. Reaching STROKE_MAX_POINTS commits the
// current part and continues a new part from its last point. pointercancel or
// lostpointercapture finish like a release, keeping the points so far. The
// catcher covers the board, so a Pen drag never pans or moves objects; wheel
// events bubble to BoardViewport, so scrolling still navigates. The tool stays
// active after every commit.

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { STROKE_MAX_POINTS, STROKE_SIMPLIFY_TOLERANCE_PX } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import type { UndoController } from '../board/undo';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  undo?: UndoController;
}

type ScreenPoint = { x: number; y: number };

export function PenTool({
  camera,
  color,
  thickness,
  doc,
  identityId,
  undo,
}: PenToolProps): React.JSX.Element {
  const catcherRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const optionsRef = useRef({ color, thickness });
  optionsRef.current = { color, thickness };

  const drawingRef = useRef(false);
  const pointsRef = useRef<Point[]>([]);
  const startScreenRef = useRef<ScreenPoint>({ x: 0, y: 0 });
  const lastScreenRef = useRef<ScreenPoint>({ x: 0, y: 0 });
  const cleanupRef = useRef<(() => void) | null>(null);
  const rafRef = useRef<number | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [, setPreviewTick] = useState(0);

  const commit = useCallback(
    (points: readonly Point[]): void => {
      if (points.length === 0) return;
      const { color: c, thickness: t } = optionsRef.current;
      const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / (cameraRef.current.zoom || 1);
      const simplified = simplify(points, tolerance);
      undo?.boundary(); // one undo step per committed stroke part
      createStroke(doc, { points: simplified, color: c, thickness: t }, identityId);
      undo?.boundary(); // stopCapturing: the next stroke is a separate step
    },
    [doc, identityId, undo],
  );

  const schedulePreview = useCallback((): void => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setPreviewTick((n) => n + 1);
    });
  }, []);

  const append = useCallback(
    (world: Point): void => {
      const pts = pointsRef.current;
      pts.push(world);
      if (pts.length >= STROKE_MAX_POINTS) {
        commit(pts);
        pointsRef.current = [pts[pts.length - 1]];
      }
    },
    [commit],
  );

  const finish = useCallback(
    (endScreen: ScreenPoint): void => {
      if (!drawingRef.current) return; // e.g. lostpointercapture after up
      drawingRef.current = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
      const points = pointsRef.current;
      pointsRef.current = [];
      setDrawing(false);
      if (points.length === 0) return;
      const moved = Math.hypot(
        endScreen.x - startScreenRef.current.x,
        endScreen.y - startScreenRef.current.y,
      );
      if (moved < DRAG_THRESHOLD_PX) {
        commit([points[0]]); // click draws a dot
      } else {
        commit(points);
      }
    },
    [commit],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.button !== 0 || drawingRef.current) return;
      const el = catcherRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      drawingRef.current = true;
      startScreenRef.current = { x: sx, y: sy };
      lastScreenRef.current = { x: sx, y: sy };
      pointsRef.current = [screenToWorld(cameraRef.current, { x: sx, y: sy })];
      setDrawing(true);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // jsdom: no pointer capture; window listeners below still drive it.
      }

      const onMove = (ev: PointerEvent): void => {
        if (!drawingRef.current) return;
        const coalesced =
          typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
        const events = coalesced.length > 0 ? coalesced : [ev];
        for (const ce of events) {
          const px = ce.clientX - rect.left;
          const py = ce.clientY - rect.top;
          lastScreenRef.current = { x: px, y: py };
          append(screenToWorld(cameraRef.current, { x: px, y: py }));
        }
        schedulePreview();
      };
      const onUp = (ev: PointerEvent): void => {
        finish({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
      };
      const onCancel = (ev: PointerEvent): void => {
        finish({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
      };
      const onLostCapture = (): void => {
        finish({ ...lastScreenRef.current });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      el.addEventListener('lostpointercapture', onLostCapture);
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        el.removeEventListener('lostpointercapture', onLostCapture);
      };
    },
    [append, finish, schedulePreview],
  );

  // Unmounting (Escape or switching tools) cancels an unfinished drag: the
  // preview disappears and nothing is committed.
  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      drawingRef.current = false;
      pointsRef.current = [];
    },
    [],
  );

  const moveCursor = useCallback((clientX: number, clientY: number): void => {
    const cursor = cursorRef.current;
    const catcher = catcherRef.current;
    if (!cursor || !catcher) return;
    const rect = catcher.getBoundingClientRect();
    cursor.style.left = `${clientX - rect.left}px`;
    cursor.style.top = `${clientY - rect.top}px`;
  }, []);

  let preview: React.JSX.Element | null = null;
  if (drawing) {
    const cam = cameraRef.current;
    const screenPts = pointsRef.current.map((p) => worldToScreen(cam, p));
    preview = (
      <svg className="pen-preview" data-testid="pen-preview">
        <path
          d={smoothPath(screenPts)}
          fill="none"
          stroke={PEN_COLORS[color]}
          strokeWidth={Math.max(1, PEN_THICKNESS_WORLD[thickness] * cam.zoom)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  const cursorSize = Math.max(2, PEN_THICKNESS_WORLD[thickness] * camera.zoom);

  return (
    <div
      ref={catcherRef}
      data-testid="pen-tool-catcher"
      className="pen-tool-catcher"
      onPointerDown={onPointerDown}
      onPointerMove={(e) => moveCursor(e.clientX, e.clientY)}
    >
      {preview}
      <div
        ref={cursorRef}
        data-testid="pen-cursor"
        className="pen-cursor"
        style={{
          width: cursorSize,
          height: cursorSize,
          background: PEN_COLORS[color],
          left: -cursorSize,
          top: -cursorSize,
        }}
      />
    </div>
  );
}
