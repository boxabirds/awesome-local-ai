/**
 * Connector tool (story 10, connector.ui).
 *
 * Shows hover dots on objects, handles drag-to-create connectors,
 * highlights the target's nearest side dot during drag.
 */
import { useRef, useState, useCallback } from 'react';
import type * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import { nearestSide, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';

interface ConnectorToolProps {
  camera: Camera;
  doc: Y.Doc;
  snapshot: readonly ObjectSnapshot[];
  createdBy: string;
  onCreated(id: string): void;
  onBoundary(): void;
}

interface HoverState {
  objectId: string;
  dots: { x: number; y: number }[]; // screen-space
  side: Side; // nearest side to current pointer (for highlighting during drag)
}

export function ConnectorTool({ camera, doc, snapshot, createdBy, onCreated, onBoundary }: ConnectorToolProps) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null); // screen space
  const [dragEnd, setDragEnd] = useState<Point | null>(null); // screen space
  const [dragTargetSide, setDragTargetSide] = useState<Side | null>(null);
  const dragStartObjectRef = useRef<string | null>(null);
  const dragStartFreeRef = useRef<Point | null>(null); // world space free point

  const hitTest = useCallback((screen: Point): string | null => {
    const world = screenToWorld(camera, screen);
    // Test in reverse z-order (topmost first)
    const sorted = [...snapshot].sort((a, b) => b.z - a.z);
    for (const obj of sorted) {
      const b = objectBounds(obj);
      if (world.x >= b.x && world.x < b.x + b.width && world.y >= b.y && world.y < b.y + b.height) {
        return obj.id;
      }
    }
    return null;
  }, [camera, snapshot]);

  const getDots = useCallback((objectId: string, pointerWorld: Point): { dots: { x: number; y: number }[]; side: Side } => {
    const obj = snapshot.find((o) => o.id === objectId);
    if (!obj) return { dots: [], side: 'right' };
    const b = objectBounds(obj);
    const sides: Side[] = ['top', 'right', 'bottom', 'left'];
    const dots = sides.map((s) => {
      const anchor = sideAnchor(b, s);
      return { x: (anchor.x - camera.x) * camera.zoom, y: (anchor.y - camera.y) * camera.zoom };
    });
    const side = nearestSide(b, pointerWorld);
    return { dots, side };
  }, [camera, snapshot]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button != null && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screen: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragStart(screen);
    setDragEnd(screen);

    const objectId = hitTest(screen);
    dragStartObjectRef.current = objectId;
    if (!objectId) {
      dragStartFreeRef.current = screenToWorld(camera, screen);
    }

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* jsdom */ }
  }, [camera, hitTest]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screen: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = screenToWorld(camera, screen);

    if (dragStart) {
      // During drag: update drag end and highlight target
      setDragEnd(screen);
      const targetId = hitTest(screen);
      if (targetId && targetId !== dragStartObjectRef.current) {
        const { side } = getDots(targetId, world);
        setDragTargetSide(side);
      } else {
        setDragTargetSide(null);
      }
    } else {
      // Hovering: show dots on object under pointer
      const objectId = hitTest(screen);
      if (objectId) {
        const { dots, side } = getDots(objectId, world);
        setHover({ objectId, dots, side });
      } else {
        setHover(null);
      }
    }
  }, [camera, dragStart, hitTest, getDots]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragStart) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const endScreen: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const endWorld = screenToWorld(camera, endScreen);
    const startWorld = screenToWorld(camera, dragStart);

    setDragStart(null);
    setDragEnd(null);
    setDragTargetSide(null);

    const targetId = hitTest(endScreen);
    const startObjectId = dragStartObjectRef.current;
    dragStartObjectRef.current = null;
    dragStartFreeRef.current = null;

    // Check: same object or too short
    if (targetId && targetId === startObjectId) return;
    const length = Math.hypot(endWorld.x - startWorld.x, endWorld.y - startWorld.y);
    if (length < CONNECTOR_MIN_LENGTH_WORLD) return;

    // Build endpoints
    const from: Endpoint = startObjectId
      ? { kind: 'attached', objectId: startObjectId, fallback: startWorld }
      : { kind: 'free', x: startWorld.x, y: startWorld.y };

    const to: Endpoint = targetId
      ? { kind: 'attached', objectId: targetId, fallback: endWorld }
      : { kind: 'free', x: endWorld.x, y: endWorld.y };

    const id = createConnector(doc, from, to, createdBy);
    if (id) {
      onBoundary();
      onCreated(id);
    }
  }, [camera, dragStart, hitTest, doc, createdBy, onCreated, onBoundary]);

  const handlePointerCancel = useCallback(() => {
    setDragStart(null);
    setDragEnd(null);
    setDragTargetSide(null);
    dragStartObjectRef.current = null;
    dragStartFreeRef.current = null;
  }, []);

  // Determine which dot to highlight
  const highlightedDotIndex = dragTargetSide
    ? { top: 0, right: 1, bottom: 2, left: 3 }[dragTargetSide]
    : null;

  return (
    <div
      data-testid="connector-tool"
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        zIndex: 5,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* Hover dots */}
      {hover && !dragStart && hover.dots.map((dot, i) => (
        <div
          key={i}
          data-testid="connector-dot"
          style={{
            position: 'absolute',
            left: dot.x - CONNECTOR_DOT_RADIUS_PX,
            top: dot.y - CONNECTOR_DOT_RADIUS_PX,
            width: CONNECTOR_DOT_RADIUS_PX * 2,
            height: CONNECTOR_DOT_RADIUS_PX * 2,
            borderRadius: '50%',
            background: '#3b82f6',
            border: '1px solid white',
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* Drag line preview */}
      {dragStart && dragEnd && (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <line
            x1={dragStart.x}
            y1={dragStart.y}
            x2={dragEnd.x}
            y2={dragEnd.y}
            stroke="#3b82f6"
            strokeWidth={2}
            strokeDasharray="4 4"
          />
        </svg>
      )}

      {/* Highlighted target dot during drag */}
      {dragStart && dragTargetSide && hover && (
        <div
          data-testid="connector-dot-highlight"
          style={{
            position: 'absolute',
            left: hover.dots[highlightedDotIndex!].x - CONNECTOR_DOT_RADIUS_PX - 2,
            top: hover.dots[highlightedDotIndex!].y - CONNECTOR_DOT_RADIUS_PX - 2,
            width: (CONNECTOR_DOT_RADIUS_PX + 2) * 2,
            height: (CONNECTOR_DOT_RADIUS_PX + 2) * 2,
            borderRadius: '50%',
            background: '#ef4444',
            border: '2px solid white',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
