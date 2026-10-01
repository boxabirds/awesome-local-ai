import { useRef, useState, useCallback, type ReactElement } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import {
  nearestSide,
  sideAnchor,
  type Side,
  type Endpoint,
} from '../../shared/geometry/connector-geometry';
import { createConnector } from '../../shared/objects/connector';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';
import type * as Y from 'yjs';

export interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  createdBy: string;
  onCreated: (id: string) => void;
}

interface HoverState {
  objectId: string;
  rect: Rect;
  dots: Array<{ side: Side; x: number; y: number }>;
  highlightedSide: Side | null;
}

/**
 * The Connector tool (story 10, connector.ui): hover over objects to see
 * connection dots, drag from one object to another to create a connector.
 */
export function ConnectorTool({ camera, snapshot, doc, createdBy, onCreated }: ConnectorToolProps): ReactElement {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [dragPreview, setDragPreview] = useState<{ from: Point; to: Point } | null>(null);
  const dragStartRef = useRef<{ screenPoint: Point; worldPoint: Point; objectId: string | null } | null>(null);
  const isDraggingRef = useRef(false);

  // Build a rects map from the snapshot
  const rectsMap = new Map<string, Rect>();
  for (const o of snapshot) {
    rectsMap.set(o.id, objectBounds(o));
  }

  const findObjectAt = useCallback((worldPoint: Point): ObjectSnapshot | null => {
    // Find the topmost object containing the point
    let found: ObjectSnapshot | null = null;
    let maxZ = -1;
    for (const o of snapshot) {
      const r = objectBounds(o);
      if (
        worldPoint.x >= r.x && worldPoint.x <= r.x + r.width &&
        worldPoint.y >= r.y && worldPoint.y <= r.y + r.height
      ) {
        if (o.z > maxZ) {
          maxZ = o.z;
          found = o;
        }
      }
    }
    return found;
  }, [snapshot]);

  const makeDots = useCallback((rect: Rect): Array<{ side: Side; x: number; y: number }> => {
    const sides: Side[] = ['top', 'right', 'bottom', 'left'];
    return sides.map((s) => ({ side: s, ...sideAnchor(rect, s) }));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.nativeEvent.button !== 0) return;
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screenPoint: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPoint = screenToWorld(camera, screenPoint);
    const obj = findObjectAt(worldPoint);

    dragStartRef.current = {
      screenPoint,
      worldPoint,
      objectId: obj?.id ?? null,
    };
    isDraggingRef.current = false;
  }, [camera, findObjectAt]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screenPoint: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPoint = screenToWorld(camera, screenPoint);

    if (dragStartRef.current) {
      // Dragging
      isDraggingRef.current = true;
      setDragPreview({ from: dragStartRef.current.worldPoint, to: worldPoint });

      // Highlight the target's nearest side dot
      const target = findObjectAt(worldPoint);
      if (target && target.id !== dragStartRef.current.objectId) {
        const r = objectBounds(target);
        const side = nearestSide(r, dragStartRef.current.worldPoint);
        setHover({
          objectId: target.id,
          rect: r,
          dots: makeDots(r),
          highlightedSide: side,
        });
      } else {
        setHover(null);
      }
    } else {
      // Hovering
      const obj = findObjectAt(worldPoint);
      if (obj) {
        const r = objectBounds(obj);
        setHover({
          objectId: obj.id,
          rect: r,
          dots: makeDots(r),
          highlightedSide: null,
        });
      } else {
        setHover(null);
      }
    }
  }, [camera, findObjectAt, makeDots]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screenPoint: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPoint = screenToWorld(camera, screenPoint);
    const start = dragStartRef.current;
    dragStartRef.current = null;
    isDraggingRef.current = false;
    setDragPreview(null);
    setHover(null);

    // Check minimum drag distance
    const dx = worldPoint.x - start.worldPoint.x;
    const dy = worldPoint.y - start.worldPoint.y;
    if (Math.hypot(dx, dy) < 8) return; // too short, no connector

    const target = findObjectAt(worldPoint);

    // Build endpoints
    let from: Endpoint;
    let to: Endpoint;

    if (start.objectId) {
      const r = rectsMap.get(start.objectId);
      if (r) {
        const side = nearestSide(r, worldPoint);
        from = { kind: 'attached', objectId: start.objectId, fallback: sideAnchor(r, side) };
      } else {
        from = { kind: 'free', x: start.worldPoint.x, y: start.worldPoint.y };
      }
    } else {
      from = { kind: 'free', x: start.worldPoint.x, y: start.worldPoint.y };
    }

    if (target) {
      // Check not the same object
      if (start.objectId && target.id === start.objectId) return;
      const r = objectBounds(target);
      const side = nearestSide(r, start.worldPoint);
      to = { kind: 'attached', objectId: target.id, fallback: sideAnchor(r, side) };
    } else {
      to = { kind: 'free', x: worldPoint.x, y: worldPoint.y };
    }

    const id = createConnector(doc, from, to, createdBy);
    if (id) onCreated(id);
  }, [camera, findObjectAt, doc, createdBy, onCreated, rectsMap]);

  const handlePointerCancel = useCallback(() => {
    dragStartRef.current = null;
    isDraggingRef.current = false;
    setDragPreview(null);
    setHover(null);
  }, []);

  const dotR = CONNECTOR_DOT_RADIUS_PX;

  return (
    <div
      data-testid="connector-tool-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 15,
        cursor: 'crosshair',
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* Connection dots */}
      {hover && (
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          {hover.dots.map((d) => {
            const sp = {
              x: (d.x - camera.x) * camera.zoom,
              y: (d.y - camera.y) * camera.zoom,
            };
            const highlighted = hover.highlightedSide === d.side;
            return (
              <circle
                key={d.side}
                data-testid={`connector-dot-${d.side}`}
                cx={sp.x}
                cy={sp.y}
                r={highlighted ? dotR + 2 : dotR}
                fill={highlighted ? '#1565C0' : '#FFFFFF'}
                stroke="#1565C0"
                strokeWidth={1.5}
              />
            );
          })}
        </svg>
      )}
      {/* Drag preview line */}
      {dragPreview && (
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          <line
            x1={(dragPreview.from.x - camera.x) * camera.zoom}
            y1={(dragPreview.from.y - camera.y) * camera.zoom}
            x2={(dragPreview.to.x - camera.x) * camera.zoom}
            y2={(dragPreview.to.y - camera.y) * camera.zoom}
            stroke="#1565C0"
            strokeWidth={2}
            strokeDasharray="5,5"
          />
        </svg>
      )}
    </div>
  );
}
