/**
 * ConnectorTool: hover dots on objects, drag to create arrows, highlights
 * the target object's nearest-side dot.
 */
import { useCallback, useRef, useState } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';
import { nearestSide, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';

export interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  onCreated(id: string): void;
  /** Called on pointerup with the from/to endpoints. Returns id or null. */
  onCreateConnector(
    from: { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number },
    to: { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number },
  ): string | null;
  undoBoundary(): void;
  zoom: number;
}

interface DragState {
  startScreen: Point;
  endScreen: Point;
  startObjectId: string | null;
  targetObjectId: string | null;
  targetSide: Side | null;
}

function buildRectsMap(snapshot: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const obj of snapshot) {
    if (obj.type === 'connector') continue;
    const w = 'width' in obj && obj.width !== undefined ? obj.width : 200;
    const h = 'height' in obj && obj.height !== undefined ? obj.height : 200;
    rects.set(obj.id, { x: obj.x, y: obj.y, width: w, height: h });
  }
  return rects;
}

function hitTestObject(
  snapshot: readonly ObjectSnapshot[],
  world: Point,
): string | null {
  // Walk from top (highest z) to bottom
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const obj = snapshot[i]!;
    if (obj.type === 'connector') continue;
    const w = 'width' in obj && obj.width !== undefined ? obj.width : 200;
    const h = 'height' in obj && obj.height !== undefined ? obj.height : 200;
    if (world.x >= obj.x && world.x <= obj.x + w && world.y >= obj.y && world.y <= obj.y + h) {
      return obj.id;
    }
  }
  return null;
}

export function ConnectorTool(props: ConnectorToolProps): React.JSX.Element {
  const { camera, snapshot, onCreated, onCreateConnector, undoBoundary, zoom } = props;
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoverObjectId, setHoverObjectId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const rects = buildRectsMap(snapshot);

  const pointOf = useCallback((clientX: number, clientY: number): Point => {
    const el = containerRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const p = pointOf(e.clientX, e.clientY);
      const world = screenToWorld(camera, p);

      if (dragRef.current) {
        // Update drag state
        const targetId = hitTestObject(snapshot, world);
        const startId = dragRef.current.startObjectId;
        const resolvedTarget = targetId && targetId !== startId ? targetId : null;
        let targetSide: Side | null = null;
        if (resolvedTarget) {
          const targetRect = rects.get(resolvedTarget);
          if (targetRect) {
            // Determine the start end world point for nearestSide
            let startWorld: Point;
            if (startId) {
              const sr = rects.get(startId);
              startWorld = sr ? { x: sr.x + sr.width / 2, y: sr.y + sr.height / 2 } : world;
            } else {
              startWorld = screenToWorld(camera, dragRef.current.startScreen);
            }
            targetSide = nearestSide(targetRect, startWorld);
          }
        }
        const newState: DragState = {
          startScreen: dragRef.current.startScreen,
          endScreen: p,
          startObjectId: startId,
          targetObjectId: resolvedTarget,
          targetSide,
        };
        dragRef.current = newState;
        setDragState(newState);
      } else {
        // Hover
        const id = hitTestObject(snapshot, world);
        setHoverObjectId(id);
      }
    },
    [camera, snapshot, pointOf, rects],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const el = containerRef.current;
      if (!el) return;
      el.setPointerCapture?.(e.pointerId);
      const p = pointOf(e.clientX, e.clientY);
      const world = screenToWorld(camera, p);
      const startId = hitTestObject(snapshot, world);

      const state: DragState = {
        startScreen: p,
        endScreen: p,
        startObjectId: startId,
        targetObjectId: null,
        targetSide: null,
      };
      dragRef.current = state;
      setDragState(state);
    },
    [camera, snapshot, pointOf],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const el = containerRef.current;
      if (el?.hasPointerCapture?.(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }

      const state = dragRef.current;
      dragRef.current = null;
      setDragState(null);
      setHoverObjectId(null);

      const worldEnd = screenToWorld(camera, state.endScreen);
      const endId = hitTestObject(snapshot, worldEnd);

      // Build from endpoint
      let from: { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number };
      if (state.startObjectId) {
        const startRect = rects.get(state.startObjectId);
        if (startRect) {
          // Determine side from the other end
          let otherPt: Point;
          if (endId && endId !== state.startObjectId) {
            const endRect = rects.get(endId);
            otherPt = endRect ? { x: endRect.x + endRect.width / 2, y: endRect.y + endRect.height / 2 } : worldEnd;
          } else {
            otherPt = worldEnd;
          }
          const side = nearestSide(startRect, otherPt);
          const anchor = sideAnchor(startRect, side);
          from = { kind: 'attached', objectId: state.startObjectId, fallback: anchor };
        } else {
          const worldStart = screenToWorld(camera, state.startScreen);
          from = { kind: 'free', x: worldStart.x, y: worldStart.y };
        }
      } else {
        const worldStart = screenToWorld(camera, state.startScreen);
        from = { kind: 'free', x: worldStart.x, y: worldStart.y };
      }

      // Build to endpoint
      let to: { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number };
      if (endId && endId !== state.startObjectId) {
        const endRect = rects.get(endId);
        if (endRect) {
          let otherPt: Point;
          if (state.startObjectId) {
            const sr = rects.get(state.startObjectId);
            otherPt = sr ? { x: sr.x + sr.width / 2, y: sr.y + sr.height / 2 } : screenToWorld(camera, state.startScreen);
          } else {
            otherPt = screenToWorld(camera, state.startScreen);
          }
          const side = nearestSide(endRect, otherPt);
          const anchor = sideAnchor(endRect, side);
          to = { kind: 'attached', objectId: endId, fallback: anchor };
        } else {
          to = { kind: 'free', x: worldEnd.x, y: worldEnd.y };
        }
      } else {
        // Released over empty space or same object
        to = { kind: 'free', x: worldEnd.x, y: worldEnd.y };
      }

      undoBoundary();
      const id = onCreateConnector(from, to);
      undoBoundary();
      if (id) {
        onCreated(id);
      }
    },
    [camera, snapshot, rects, onCreated, onCreateConnector, undoBoundary],
  );

  const onPointerCancel = useCallback(() => {
    dragRef.current = null;
    setDragState(null);
    setHoverObjectId(null);
  }, []);

  // Render hover dots and preview line
  const dotRadius = CONNECTOR_DOT_RADIUS_PX / zoom;
  const hoverRect = hoverObjectId && !dragState ? rects.get(hoverObjectId) : null;
  const dots: Array<{ x: number; y: number; highlighted: boolean }> = [];

  if (dragState && dragState.targetObjectId && dragState.targetSide) {
    const targetRect = rects.get(dragState.targetObjectId);
    if (targetRect) {
      const sides = ['top', 'right', 'bottom', 'left'] as const;
      for (const s of sides) {
        const anchor = sideAnchor(targetRect, s);
        dots.push({ x: anchor.x, y: anchor.y, highlighted: s === dragState.targetSide });
      }
    }
  } else if (hoverRect) {
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    for (const s of sides) {
      const anchor = sideAnchor(hoverRect, s);
      dots.push({ x: anchor.x, y: anchor.y, highlighted: false });
    }
  }

  // Preview line in world space
  let lineFrom: Point | null = null;
  let lineTo: Point | null = null;
  if (dragState) {
    lineFrom = screenToWorld(camera, dragState.startScreen);
    lineTo = screenToWorld(camera, dragState.endScreen);
  }

  return (
    <div
      ref={containerRef}
      data-testid="connector-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        zIndex: 10,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
        {/* Preview line */}
        {lineFrom && lineTo && (
          <line
            data-testid="connector-preview"
            x1={(lineFrom.x - camera.x) * zoom}
            y1={(lineFrom.y - camera.y) * zoom}
            x2={(lineTo.x - camera.x) * zoom}
            y2={(lineTo.y - camera.y) * zoom}
            stroke="#1E88E5"
            strokeWidth={2}
            strokeDasharray="6 3"
          />
        )}
        {/* Hover/connection dots */}
        {dots.map((dot, i) => (
          <circle
            key={i}
            data-testid={dot.highlighted ? 'connector-dot-highlighted' : 'connector-dot'}
            cx={(dot.x - camera.x) * zoom}
            cy={(dot.y - camera.y) * zoom}
            r={dotRadius}
            fill={dot.highlighted ? '#1E88E5' : '#90CAF9'}
            stroke="#1E88E5"
            strokeWidth={1}
          />
        ))}
      </svg>
    </div>
  );
}
