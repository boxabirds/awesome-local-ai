import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Doc } from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { createConnector } from '../../shared/objects/connector';
import {
  nearestSide,
  sideAnchor,
  type Side,
  type Endpoint,
} from '../../shared/geometry/connector-geometry';
import type { Rect, Point } from '../../shared/geometry';
import {
  CONNECTOR_ANCHOR_RADIUS_WORLD,
  CONNECTOR_ANCHOR_HIT_RADIUS_WORLD,
} from '../../shared/config';

interface DragState {
  fromObjId: string;
  fromSide: Side;
  currentWorld: Point;
}

export function ConnectorTool({
  camera,
  snapshot,
  doc,
  onCreated,
  onBoundary,
}: {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  doc: Doc;
  onCreated: (id: string) => void;
  onBoundary?: () => void;
}) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoverShape, setHoverShape] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);

  // Build rects map
  const rects = new Map<string, Rect>();
  for (const obj of snapshot) {
    if (obj.type === 'connector') continue;
    rects.set(obj.id, objectBounds(obj));
  }

  const findShapeAt = useCallback((world: Point): string | null => {
    for (const obj of snapshot) {
      if (obj.type === 'connector') continue;
      const b = rects.get(obj.id);
      if (!b) continue;
      if (world.x >= b.x && world.x <= b.x + b.width &&
          world.y >= b.y && world.y <= b.y + b.height) {
        return obj.id;
      }
    }
    return null;
  }, [snapshot, rects]);

  const findEndpointAt = useCallback((world: Point): { objId: string; side: Side } | null => {
    for (const obj of snapshot) {
      if (obj.type === 'connector') continue;
      const b = rects.get(obj.id);
      if (!b) continue;
      const sides: Side[] = ['left', 'right', 'top', 'bottom'];
      for (const side of sides) {
        const anchor = sideAnchor(b, side);
        const dx = world.x - anchor.x;
        const dy = world.y - anchor.y;
        if (dx * dx + dy * dy < CONNECTOR_ANCHOR_HIT_RADIUS_WORLD * CONNECTOR_ANCHOR_HIT_RADIUS_WORLD) {
          return { objId: obj.id, side };
        }
      }
    }
    return null;
  }, [snapshot, rects]);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not supported in jsdom */ }

    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });

    // First check if clicking on a specific anchor dot
    const endpoint = findEndpointAt(world);
    let objId = endpoint?.objId ?? null;
    let side: Side = endpoint?.side ?? 'right';

    // If not on a dot, check if hovering over a shape (find nearest side)
    if (!objId) {
      objId = findShapeAt(world);
      if (objId) {
        const b = rects.get(objId);
        if (b) side = nearestSide(b, world);
      }
    }

    if (!objId) return;

    const drag: DragState = { fromObjId: objId, fromSide: side, currentWorld: world };
    dragRef.current = drag;
    setDragState(drag);
  }, [camera, findEndpointAt, findShapeAt, rects]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });

    if (dragRef.current) {
      e.preventDefault();
      dragRef.current.currentWorld = world;
      setDragState({ ...dragRef.current });
    } else {
      // Update hover state for showing dots
      const objId = findShapeAt(world);
      if (objId !== hoverShape) setHoverShape(objId);
    }
  }, [camera, hoverShape, findShapeAt]);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = null;
    setDragState(null);

    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const toObjId = findShapeAt(world);

    if (!toObjId || toObjId === d.fromObjId) return;

    const toRect = rects.get(toObjId);
    const toSide: Side = toRect ? nearestSide(toRect, world) : 'left';

    // Compute anchor points for fallbacks
    const fromRect = rects.get(d.fromObjId);
    const fromFallback = fromRect ? sideAnchor(fromRect, d.fromSide) : { x: 0, y: 0 };
    const toFallback = toRect ? sideAnchor(toRect, toSide) : { x: world.x, y: world.y };

    const from: Endpoint = { kind: 'attached', objectId: d.fromObjId, fallback: fromFallback };
    const to: Endpoint = { kind: 'attached', objectId: toObjId, fallback: toFallback };

    onBoundary?.();
    const id = createConnector(doc, from, to, 'session');
    if (id) {
      onCreated(id);
    }
  }, [camera, doc, findShapeAt, rects, onCreated, onBoundary]);

  // Get screen positions for rendering
  const { worldToScreenPt } = { worldToScreenPt: (p: Point) => ({ x: (p.x - camera.x) * camera.zoom, y: (p.y - camera.y) * camera.zoom }) };

  return (
    <div
      data-testid="connector-tool-overlay"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        cursor: 'crosshair',
        zIndex: 500,
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {/* Hover dots: show anchor points on the hovered shape */}
        {!dragState && hoverShape && rects.has(hoverShape) && (() => {
          const b = rects.get(hoverShape)!;
          const sides: Side[] = ['left', 'right', 'top', 'bottom'];
          return sides.map(side => {
            const anchor = sideAnchor(b, side);
            const sp = worldToScreenPt(anchor);
            const r = CONNECTOR_ANCHOR_RADIUS_WORLD * camera.zoom;
            return (
              <circle
                key={`hover-${side}`}
                cx={sp.x} cy={sp.y}
                r={r}
                fill="#2196F3"
                stroke="#fff"
                strokeWidth={1}
                data-testid={`connector-anchor-${hoverShape}-${side}`}
              />
            );
          });
        })()}

        {/* Drag preview line */}
        {dragState && rects.has(dragState.fromObjId) && (() => {
          const fromRect = rects.get(dragState.fromObjId)!;
          const fromAnchor = sideAnchor(fromRect, dragState.fromSide);
          const fromSp = worldToScreenPt(fromAnchor);
          const toSp = worldToScreenPt(dragState.currentWorld);
          return (
            <line
              x1={fromSp.x} y1={fromSp.y}
              x2={toSp.x} y2={toSp.y}
              stroke="#2196F3"
              strokeWidth={2}
              strokeDasharray="6 3"
              opacity={0.7}
              data-testid="connector-preview-line"
            />
          );
        })()}
      </svg>
    </div>
  );
}
