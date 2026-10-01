// src/client/tools/ConnectorTool.tsx
// Connector tool: hover dots, drag preview, creation.

import { useState, useCallback, useRef } from 'react';
import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import { sideAnchor, nearestSide, type Side } from '../../shared/geometry/connector-geometry';
import type { Rect } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';

export interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  onCreated: (id: string) => void;
  /** Creates a connector. Returns the new id or null. */
  create: (from: { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number },
           to: { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number }) => string | null;
}

export function ConnectorTool(props: ConnectorToolProps): ReactElement | null {
  const { camera, snapshot, onCreated, create } = props;
  const [hoverScreen, setHoverScreen] = useState<Point | null>(null);
  const [dragState, setDragState] = useState<{ start: Point; end: Point; startObjId: string | null } | null>(null);
  const dragRef = useRef<{ start: Point; startObjId: string | null } | null>(null);

  const getScreenPoint = (e: ReactPointerEvent): Point => {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Hit test: find the object under a world point
  const hitTestObject = useCallback((worldPoint: Point): string | null => {
    for (let i = snapshot.length - 1; i >= 0; i--) {
      const obj = snapshot[i];
      if (obj.type === 'connector') continue;
      const bounds = objectBounds(obj);
      if (
        worldPoint.x >= bounds.x &&
        worldPoint.x <= bounds.x + bounds.width &&
        worldPoint.y >= bounds.y &&
        worldPoint.y <= bounds.y + bounds.height
      ) {
        return obj.id;
      }
    }
    return null;
  }, [snapshot]);

  const getObjRect = useCallback((id: string): Rect | null => {
    const obj = snapshot.find(o => o.id === id);
    if (!obj) return null;
    return objectBounds(obj);
  }, [snapshot]);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
    const sp = getScreenPoint(e);
    const worldPoint = screenToWorld(camera, sp);
    const objId = hitTestObject(worldPoint);

    dragRef.current = { start: sp, startObjId: objId };
    setDragState({ start: sp, end: sp, startObjId: objId });
  }, [camera, hitTestObject]);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const sp = getScreenPoint(e);
    setHoverScreen(sp);

    if (dragRef.current) {
      setDragState(prev => prev ? { ...prev, end: sp } : null);
    }
  }, [camera]);

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch {}

    const { start: startScreen, startObjId } = dragRef.current;
    const endScreen = getScreenPoint(e);
    dragRef.current = null;
    setDragState(null);

    const worldStart = screenToWorld(camera, startScreen);
    const worldEnd = screenToWorld(camera, endScreen);

    // Find target object
    const targetObjId = hitTestObject(worldEnd);

    // Check: reject if same object
    if (targetObjId && targetObjId === startObjId) return;

    // Check minimum length
    const length = Math.hypot(worldEnd.x - worldStart.x, worldEnd.y - worldStart.y);
    if (length < 8) return;

    // Build endpoints
    const fromEndpoint = startObjId
      ? buildAttachedEndpoint(startObjId, worldEnd, getObjRect)
      : { kind: 'free' as const, x: worldStart.x, y: worldStart.y };

    const toEndpoint = targetObjId
      ? buildAttachedEndpoint(targetObjId, worldStart, getObjRect)
      : { kind: 'free' as const, x: worldEnd.x, y: worldEnd.y };

    const id = create(fromEndpoint, toEndpoint);
    if (id) {
      onCreated(id);
    }
  }, [camera, hitTestObject, getObjRect, create, onCreated]);

  const onPointerCancel = useCallback(() => {
    dragRef.current = null;
    setDragState(null);
  }, []);

  // Compute dots for a given screen point
  const computeDots = (screenPoint: Point, highlightSide: Side | null) => {
    const worldPoint = screenToWorld(camera, screenPoint);
    const objId = hitTestObject(worldPoint);
    if (!objId) return null;

    const obj = snapshot.find(o => o.id === objId);
    if (!obj) return null;
    const bounds = objectBounds(obj);
    const sides: Side[] = ['top', 'right', 'bottom', 'left'];

    return sides.map((side) => {
      const anchor = sideAnchor(bounds, side);
      const screenPos = {
        x: (anchor.x - camera.x) * camera.zoom,
        y: (anchor.y - camera.y) * camera.zoom,
      };
      const isHighlighted = highlightSide === side;

      return (
        <circle
          key={side}
          data-testid={`connector-dot-${side}`}
          cx={screenPos.x}
          cy={screenPos.y}
          r={CONNECTOR_DOT_RADIUS_PX}
          fill={isHighlighted ? '#1E88E5' : 'white'}
          stroke="#1E88E5"
          strokeWidth={2}
          style={{ pointerEvents: 'none' }}
        />
      );
    });
  };

  // Render
  let dots: ReactElement[] | null = null;
  let previewLine: ReactElement | null = null;

  if (dragState) {
    // While dragging: show dots on the target under the cursor
    const worldEnd = screenToWorld(camera, dragState.end);
    const targetId = hitTestObject(worldEnd);
    if (targetId) {
      const obj = snapshot.find(o => o.id === targetId);
      if (obj) {
        const bounds = objectBounds(obj);
        const highlight = nearestSide(bounds, worldEnd);
        dots = computeDots(dragState.end, highlight);
      }
    }
    previewLine = (
      <line
        data-testid="connector-preview"
        x1={dragState.start.x}
        y1={dragState.start.y}
        x2={dragState.end.x}
        y2={dragState.end.y}
        stroke="#1E88E5"
        strokeWidth={2}
        strokeDasharray="6 3"
        style={{ pointerEvents: 'none' }}
      />
    );
  } else if (hoverScreen) {
    // Not dragging: show dots on hover
    dots = computeDots(hoverScreen, null);
  }

  return (
    <svg
      data-testid="connector-tool-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 500,
        cursor: 'crosshair',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {dots}
      {previewLine}
    </svg>
  );
}

function buildAttachedEndpoint(
  objectId: string,
  toward: Point,
  getObjRect: (id: string) => Rect | null,
): { kind: 'attached'; objectId: string; fallback: Point } {
  const rect = getObjRect(objectId);
  if (rect) {
    const side = nearestSide(rect, toward);
    const fallback = sideAnchor(rect, side);
    return { kind: 'attached', objectId, fallback };
  }
  return { kind: 'attached', objectId, fallback: { ...toward } };
}
