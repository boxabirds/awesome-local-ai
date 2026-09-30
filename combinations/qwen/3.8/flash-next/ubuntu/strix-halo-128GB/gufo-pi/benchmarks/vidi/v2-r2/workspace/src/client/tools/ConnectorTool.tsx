import { useRef, useCallback, useState, type ReactElement } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, type Camera, type Point } from '@client/canvas/camera';
import { type Rect } from '@shared/geometry';
import { createConnector, type Endpoint } from '@shared/objects/connector';
import { nearestSide, sideAnchor } from '@shared/geometry/connector-geometry';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
} from '@shared/config';
import type { ObjectSnapshot } from '@shared/board-model';
import { objectBounds } from '@shared/board-model';

export interface ConnectorToolProps {
  camera: Camera;
  doc: Y.Doc;
  snapshot: readonly ObjectSnapshot[];
  viewportEl: HTMLElement | null;
  onCreated(id: string): void;
  onGestureBoundary?(): void;
}

interface HoverState {
  objectId: string;
  rect: Rect;
}

interface DragState {
  startWorld: Point;
  currentWorld: Point;
  startObjectId: string | null;
  targetObjectId: string | null;
  targetRect: Rect | null;
}

function findObjectAt(
  worldPoint: Point,
  snapshot: readonly ObjectSnapshot[],
): { id: string; rect: Rect } | null {
  // Search from top (highest z) down
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
      return { id: obj.id, rect: bounds };
    }
  }
  return null;
}

export function ConnectorTool({
  camera,
  doc,
  snapshot,
  viewportEl,
  onCreated,
  onGestureBoundary,
}: ConnectorToolProps): ReactElement {
  const [hover, setHover] = useState<HoverState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lineRef = useRef<SVGLineElement | null>(null);
  const dotsRef = useRef<SVGSVGElement | null>(null);

  const getLocalPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    if (!viewportEl) return { x: 0, y: 0 };
    const rect = viewportEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, [viewportEl]);

  const screenPos = (wp: Point): Point => ({
    x: (wp.x - camera.x) * camera.zoom,
    y: (wp.y - camera.y) * camera.zoom,
  });

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const localPt = getLocalPoint(e);
    const worldPt = screenToWorld(camera, localPt);

    if (dragRef.current) {
      dragRef.current.currentWorld = worldPt;
      const target = findObjectAt(worldPt, snapshot);
      if (target && target.id !== dragRef.current.startObjectId) {
        dragRef.current.targetObjectId = target.id;
        dragRef.current.targetRect = target.rect;
      } else {
        dragRef.current.targetObjectId = null;
        dragRef.current.targetRect = null;
      }
      // Update SVG line
      updateLine();
      return;
    }

    // Hover: check if pointing at an object
    const hit = findObjectAt(worldPt, snapshot);
    if (hit) {
      setHover({ objectId: hit.id, rect: hit.rect });
    } else {
      setHover(null);
    }
  }, [camera, getLocalPoint, snapshot]);

  const updateLine = useCallback(() => {
    const line = lineRef.current;
    if (!line || !dragRef.current) return;
    const start = screenPos(dragRef.current.startWorld);
    const end = screenPos(dragRef.current.currentWorld);
    line.setAttribute('x1', String(start.x));
    line.setAttribute('y1', String(start.y));
    line.setAttribute('x2', String(end.x));
    line.setAttribute('y2', String(end.y));
  }, [camera]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const localPt = getLocalPoint(e);
    const worldPt = screenToWorld(camera, localPt);
    const hit = findObjectAt(worldPt, snapshot);

    dragRef.current = {
      startWorld: worldPt,
      currentWorld: worldPt,
      startObjectId: hit?.id ?? null,
      targetObjectId: null,
      targetRect: null,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    // Make line visible
    if (lineRef.current) lineRef.current.style.display = 'block';
  }, [camera, getLocalPoint, snapshot]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const drag = dragRef.current;
    dragRef.current = null;
    if (lineRef.current) lineRef.current.style.display = 'none';

    const localPt = getLocalPoint(e);
    const worldPt = screenToWorld(camera, localPt);

    const endHit = findObjectAt(worldPt, snapshot);

    // Same object: reject
    if (drag.startObjectId && endHit && endHit.id === drag.startObjectId) {
      return;
    }

    // Compute length
    const dx = worldPt.x - drag.startWorld.x;
    const dy = worldPt.y - drag.startWorld.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < CONNECTOR_MIN_LENGTH_WORLD) return;

    // Build endpoints
    let from: Endpoint;
    let to: Endpoint;

    if (drag.startObjectId) {
      const startRect = snapshot.find((o) => o.id === drag.startObjectId);
      const sr = startRect ? objectBounds(startRect) : null;
      const otherPt = endHit && endHit.id !== drag.startObjectId
        ? { x: endHit.rect.x + endHit.rect.width / 2, y: endHit.rect.y + endHit.rect.height / 2 }
        : worldPt;
      if (sr) {
        const side = nearestSide(sr, otherPt);
        const anchor = sideAnchor(sr, side);
        from = { kind: 'attached', objectId: drag.startObjectId, fallback: anchor };
      } else {
        from = { kind: 'free', x: worldPt.x, y: worldPt.y };
      }
    } else {
      from = { kind: 'free', x: drag.startWorld.x, y: drag.startWorld.y };
    }

    if (endHit && endHit.id !== drag.startObjectId) {
      const fromPt = from.kind === 'free' ? { x: from.x, y: from.y } : from.fallback;
      const side = nearestSide(endHit.rect, fromPt);
      const anchor = sideAnchor(endHit.rect, side);
      to = { kind: 'attached', objectId: endHit.id, fallback: anchor };
    } else {
      to = { kind: 'free', x: worldPt.x, y: worldPt.y };
    }

    if (onGestureBoundary) onGestureBoundary();
    const id = createConnector(doc, from, to, 'local');
    if (onGestureBoundary) onGestureBoundary();

    if (id) {
      onCreated(id);
    }
  }, [camera, doc, snapshot, getLocalPoint, onCreated, onGestureBoundary]);

  const handlePointerCancel = useCallback(() => {
    dragRef.current = null;
    if (lineRef.current) lineRef.current.style.display = 'none';
  }, []);

  // Render dots for hovered object
  const dots: ReactElement[] = [];
  if (hover) {
    const r = hover.rect;
    const sides: Array<{ x: number; y: number; side: string }> = [
      { ...sideAnchor(r, 'top'), side: 'top' },
      { ...sideAnchor(r, 'right'), side: 'right' },
      { ...sideAnchor(r, 'bottom'), side: 'bottom' },
      { ...sideAnchor(r, 'left'), side: 'left' },
    ];

    // Determine which side to highlight if dragging
    let highlightSide: string | null = null;
    if (dragRef.current && dragRef.current.targetObjectId === hover.objectId) {
      const otherPt = dragRef.current.startWorld;
      highlightSide = nearestSide(hover.rect, otherPt);
    }

    for (const d of sides) {
      const sp = screenPos(d);
      const highlighted = d.side === highlightSide;
      dots.push(
        <circle
          key={`${hover.objectId}-${d.side}`}
          cx={sp.x}
          cy={sp.y}
          r={CONNECTOR_DOT_RADIUS_PX}
          fill={highlighted ? '#1E88E5' : '#fff'}
          stroke={highlighted ? '#1E88E5' : '#666'}
          strokeWidth={1.5}
          data-testid={`connector-dot-${hover.objectId}-${d.side}`}
          data-highlighted={highlighted ? 'true' : 'false'}
        />,
      );
    }
  }

  return (
    <div
      data-testid="connector-tool-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 5, cursor: 'crosshair' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <svg
        ref={dotsRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
        data-testid="connector-tool-svg"
      >
        {/* Drag preview line */}
        <line
          ref={lineRef}
          style={{ display: 'none' }}
          stroke="#666"
          strokeWidth={2}
          strokeDasharray="6 3"
        />
        {/* Hover dots */}
        {dots}
      </svg>
    </div>
  );
}
