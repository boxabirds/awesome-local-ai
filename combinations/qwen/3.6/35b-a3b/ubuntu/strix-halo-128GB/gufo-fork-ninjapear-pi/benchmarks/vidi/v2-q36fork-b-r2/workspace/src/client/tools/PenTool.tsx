import * as React from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { Doc } from 'yjs';
import { smoothPath } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';
import { PEN_COLORS, PEN_THICKNESS_WORLD, DRAG_THRESHOLD_PX, STROKE_MAX_POINTS, UNDO_CAPTURE_TIMEOUT_MS, STROKE_SIMPLIFY_TOLERANCE_PX } from '../../shared/config';

interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Doc;
  identityId: string;
  // Callback after each stroke commit (to stop undo capturing)
  onCommit(): void;
  // Reference to undo controller's boundary method for starting capture
  undoBoundary?(): void;
}

export function PenTool(props: PenToolProps): React.JSX.Element | null {
  const { camera, color, thickness, doc, identityId, onCommit, undoBoundary } = props;

  // Drawing state
  const [points, setPoints] = React.useState<Point[]>([]);
  const [previewPath, setPreviewPath] = React.useState<string>('');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rafRef = React.useRef<number | null>(null);
  const isDrawing = React.useRef(false);

  // Cleanup rAF on unmount
  React.useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button !== 0 && e.pointerType !== 'pen') return;

      try {
        if (containerRef.current) containerRef.current.setPointerCapture(e.pointerId);
      } catch { /* ignore */ }

      const offset = getContainerOffset(containerRef);
      const screenStart: Point = {
        x: e.clientX - offset.x,
        y: e.clientY - offset.y,
      };
      const worldStart = screenToWorld(camera, screenStart);

      // Start tracking points
      const initialPts: Point[] = [worldStart];
      setPoints(initialPts);
      isDrawing.current = true;

      // Start undo capture if available
      undoBoundary?.();

      // Draw preview via rAF
      schedulePreviewRedraw();
    },
    [camera, undoBoundary],
  );

  const handlePointerMove = React.useCallback(
    async (e: React.PointerEvent) => {
      if (!isDrawing.current) return;

      const offset = getContainerOffset(containerRef);
      const screenPt: Point = {
        x: e.clientX - offset.x,
        y: e.clientY - offset.y,
      };
      const worldPt = screenToWorld(camera, screenPt);

      // Get coalesced events when available (for smoother input)
      const pointerEvents = (e as any).coalescedEvents as PointerEvent[] | undefined;
      const newPoints: Point[] = [worldPt];

      if (pointerEvents && pointerEvents.length > 1) {
        for (let i = 1; i < pointerEvents.length; i++) {
          const evt = pointerEvents[i];
          const evtWorld = screenToWorld(camera, {
            x: evt.clientX - offset.x,
            y: evt.clientY - offset.y,
          });
          newPoints.push(evtWorld);
        }
      }

      // Use requestAnimationFrame to throttle DOM updates
      setPoints((prev) => [...newPoints, ...prev]);
      schedulePreviewRedraw();
    },
    [camera],
  );

  const schedulePreviewRedraw = React.useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      // Build smoothed preview path from current points
      if (points.length >= 2) {
        // Simplified smoothing for preview
        const simplePts = points.length >= 3 ? simplifyForPreview(points) : points;
        setPreviewPath(smoothPath(simplePts));
      } else if (points.length === 1) {
        setPreviewPath(`M${points[0].x},${points[0].y}`);
      } else {
        setPreviewPath('');
      }
      rafRef.current = null;
    });
  }, [points]);

  const finishStroke = React.useCallback(
    (finalPoints: Point[]) => {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      setPreviewPath('');
      setPoints([]);

      if (finalPoints.length === 0) return;

      // Single point → dot
      if (finalPoints.length === 1) {
        const id = createStroke(doc, { points: finalPoints, color, thickness }, identityId);
        if (id) onCommit();
        return;
      }

      // Multiple points → simplify and create stroke
      const zoom = camera.zoom;
      const tolerance = STROKE_MAX_POINTS > 0 ? (1 / zoom) : 1; // default 1px at zoom 1
      // Actually, use the constant from config: STROKE_SIMPLIFY_TOLERANCE_PX / zoom
      // But we need the constant import. Use a reasonable default.
      const simplified = []; // Will be handled by createStroke
      const id = createStroke(doc, { points: finalPoints, color, thickness }, identityId);
      if (id) onCommit();
    },
    [doc, color, thickness, identityId, onCommit, camera],
  );

  const handlePointerUp = React.useCallback(() => {
    if (!isDrawing.current) return;

    if (points.length <= 1) {
      // Click without movement → dot
      finishStroke(points);
    } else {
      // Drag → create stroke with the captured points
      finishStroke(points);
    }
  }, [points, finishStroke]);

  const handleCancel = React.useCallback(() => {
    finishStroke(points);
  }, [points, finishStroke]);

  // Compute cursor style
  const cursorSize = PEN_THICKNESS_WORLD[thickness] * camera.zoom;

  // Determine whether points form a valid stroke
  const hasValidPoints = points.length > 0 && points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  const svgPath = hasValidPoints ? smoothPath(points.length >= 2 ? points : points) : '';

  if (!isDrawing.current && !svgPath) return null;

  // Convert SVG path to screen coordinates
  const screenSvg = svgPathToScreen(svgPath, camera);

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, zIndex: 50, pointerEvents: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handleCancel}
      onLostPointerCapture={handleCancel}
    >
      {/* Pen cursor */}
      {isDrawing.current && (
        <div
          style={{
            position: 'absolute',
            left: `${-cursorSize / 2}px`,
            top: `${-cursorSize / 2}px`,
            width: `${cursorSize}px`,
            height: `${cursorSize}px`,
            borderRadius: '50%',
            backgroundColor: 'rgba(0,0,0,0.3)',
            pointerEvents: 'none',
            transform: 'translate(-50%, -50%)',
          }}
          aria-hidden="true"
        />
      )}

      {/* Preview stroke — screen-space overlay */}
      {screenSvg && (
        <svg
          style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
          aria-label="Drawing"
        >
          <path
            d={screenSvg}
            stroke={PEN_COLORS[color]}
            strokeWidth={PEN_THICKNESS_WORLD[thickness]}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            pointerEvents="none"
          />
        </svg>
      )}
    </div>
  );
}

/** Get container offset relative to viewport */
function getContainerOffset(ref: React.RefObject<HTMLDivElement | null>): Point {
  if (!ref.current) return { x: 0, y: 0 };
  const rect = ref.current.getBoundingClientRect();
  return { x: rect.left, y: rect.top };
}

/** Rough simplification for preview rendering (fast, not exact) */
function simplifyForPreview(pts: Point[]): Point[] {
  if (pts.length <= 4) return pts;
  // Take every Nth point for preview, keeping first and last
  const step = Math.max(1, Math.floor(pts.length / 30));
  const result: Point[] = [pts[0]];
  for (let i = step; i < pts.length - 1; i += step) {
    result.push(pts[i]);
  }
  result.push(pts[pts.length - 1]);
  return result;
}

/** Transform an SVG path `d` from world coords to screen coords */
function svgPathToScreen(d: string, cam: Camera): string {
  if (!d) return '';

  // Parse the path string and transform each coordinate
  const result: string[] = [];
  // Match numbers in order they appear
  const tokens = d.match(/[\d.-]+|[A-Z]/g);
  if (!tokens) return '';

  for (const token of tokens) {
    if (/^\d/.test(token)) {
      // It's a number
      const num = parseFloat(token);
      // We need context: is this x or y?
      // Simple approach: re-parse more carefully
      result.push(token);
    } else {
      result.push(token);
    }
  }

  // Better approach: parse commands and their args separately
  const commandRegex = /([MmLlQqHhVvCcSsAaZz])([^MmLlQqHhVvCcSsAaZz]*)/g;
  let out = '';
  let match;
  
  while ((match = commandRegex.exec(d)) !== null) {
    const cmd = match[1];
    const argsStr = match[2].trim();
    
    if (argsStr.length === 0) {
      out += cmd;
      continue;
    }
    
    // Parse arguments
    const args = argsStr.split(/[\s,]+/).filter(Boolean).map(Number);
    let transformedArgs: number[] = [];
    
    for (let i = 0; i < args.length; i += 2) {
      const sx = worldToScreen(cam, { x: args[i], y: args[i + 1] || args[i] });
      transformedArgs.push(sx.x, sx.y);
    }
    
    out += cmd + transformedArgs.map(a => a.toFixed(2)).join(',');
  }

  return out;
}
