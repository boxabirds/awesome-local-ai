import * as React from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD, DRAG_THRESHOLD_PX } from '../../shared/config';
import { objectBounds } from '../../shared/geometry';
import { createConnector } from '../../shared/objects/connector';

interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  doc: import('yjs').Doc;
  onCreated(id: string): void;
  selection: { click(id: string): void };
}

export function ConnectorTool(props: ConnectorToolProps): React.JSX.Element | null {
  const { camera, snapshot, doc, onCreated, selection } = props;

  // Hover state
  const [hoverObjId, setHoverObjId] = React.useState<string | null>(null);
  // Drag preview state
  const [dragPreview, setDragPreview] = React.useState<{
    startWorld: Point;
    endWorld: Point;
    startObjId: string | null;
  } | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!dragPreview) {
        // Compute hover target
        const offset = getContainerOffset(containerRef);
        const screenPt: Point = { x: e.clientX - offset.x, y: e.clientY - offset.y };
        const worldPt = screenToWorld(camera, screenPt);
        hitTestObjects(snapshot, worldPt).then((hit) => {
          setHoverObjId(hit?.id ?? null);
        });
      } else {
        // Update drag preview
        const offset = getContainerOffset(containerRef);
        const screenEnd: Point = {
          x: e.clientX - offset.x,
          y: e.clientY - offset.y,
        };
        const worldEnd = screenToWorld(camera, screenEnd);
        setDragPreview((prev) => (prev ? { ...prev, endWorld: worldEnd } : null));
      }
    },
    [camera, dragPreview, snapshot],
  );

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        if (containerRef.current) containerRef.current.setPointerCapture(e.pointerId);
      } catch { /* ignore */ }

      const offset = getContainerOffset(containerRef);
      const screenStart: Point = {
        x: e.clientX - offset.x,
        y: e.clientY - offset.y,
      };
      const worldStart = screenToWorld(camera, screenStart);

      // Determine what we're dragging from
      const hit = hitTestObjectAtPoint(snapshot, worldStart);

      setDragPreview({
        startWorld: worldStart,
        endWorld: worldStart,
        startObjId: hit?.id ?? null,
      });
    },
    [camera, snapshot],
  );

  const handlePointerUp = React.useCallback(() => {
    if (!dragPreview) return;
    const { startWorld, endWorld, startObjId } = dragPreview;

    // Check min length
    const dx = endWorld.x - startWorld.x;
    const dy = endWorld.y - startWorld.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < CONNECTOR_MIN_LENGTH_WORLD) {
      setDragPreview(null);
      return;
    }

    // Find target object at end point
    const targetHit = hitTestObjectAtPoint(snapshot, endWorld);

    // Build endpoints
    const fromEp = buildEndpoint(startObjId, startWorld, snapshot);
    const toEp = buildEndpoint(targetHit?.id ?? null, endWorld, snapshot);

    // Don't create if both ends attach to same object
    const fromId = fromEp.kind === 'attached' ? fromEp.objectId : undefined;
    const toId = toEp.kind === 'attached' ? toEp.objectId : undefined;
    if (fromId && toId && fromId === toId) {
      setDragPreview(null);
      return;
    }

    // Don't create if starting from empty space and dropping on empty space with no valid endpoints
    if (!fromEp || !toEp) {
      setDragPreview(null);
      return;
    }

    const id = createConnector(doc, fromEp, toEp, 'local');
    if (id) {
      onCreated(id);
      selection.click(id);
    }

    setDragPreview(null);
  }, [dragPreview, snapshot, doc, onCreated, selection]);

  const handleCancel = React.useCallback(() => {
    setDragPreview(null);
    setHoverObjId(null);
  }, []);

  if (!dragPreview && !hoverObjId) return null;

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, zIndex: 50, pointerEvents: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handleCancel}
    >
      {/* Hover dots for target object */}
      {hoverObjId && renderHoverDots(hoverObjId, snapshot, camera)}

      {/* Drag preview line */}
      {dragPreview && (
        <svg
          style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
          aria-hidden="true"
        >
          {renderArrowPreview(dragPreview.startWorld, dragPreview.endWorld)}
        </svg>
      )}
    </div>
  );
}

function getContainerOffset(ref: React.RefObject<HTMLDivElement | null>): Point {
  if (!ref.current) return { x: 0, y: 0 };
  const rect = ref.current.getBoundingClientRect();
  return { x: rect.left, y: rect.top };
}

async function hitTestObjects(
  snapshot: readonly ObjectSnapshot[],
  worldPt: Point,
): Promise<{ id: string } | null> {
  // Simple synchronous hit test
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const obj = snapshot[i];
    if (!obj.id) continue;
    const bounds = objectBounds(obj);
    if (
      worldPt.x >= bounds.x &&
      worldPt.y >= bounds.y &&
      worldPt.x <= bounds.x + bounds.width &&
      worldPt.y <= bounds.y + bounds.height
    ) {
      return { id: obj.id };
    }
  }
  return null;
}

function hitTestObjectAtPoint(
  snapshot: readonly ObjectSnapshot[],
  worldPt: Point,
): { id: string } | null {
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const obj = snapshot[i];
    if (!obj.id) continue;
    const bounds = objectBounds(obj);
    if (
      worldPt.x >= bounds.x &&
      worldPt.y >= bounds.y &&
      worldPt.x <= bounds.x + bounds.width &&
      worldPt.y <= bounds.y + bounds.height
    ) {
      return { id: obj.id };
    }
  }
  return null;
}

function buildEndpoint(
  objId: string | null,
  boardPoint: Point,
  snapshot: readonly ObjectSnapshot[],
) {
  if (!objId) {
    // Free endpoint
    return { kind: 'free' as const, x: boardPoint.x, y: boardPoint.y };
  }
  // Attached — find fallback from nearest side of the target
  const obj = snapshot.find((s) => s.id === objId);
  if (!obj) {
    // Target missing → use the board point directly
    return { kind: 'free' as const, x: boardPoint.x, y: boardPoint.y };
  }
  const bounds = objectBounds(obj);
  // We need the other end's position to compute nearest side
  // For now use center as fallback
  return {
    kind: 'attached' as const,
    objectId: objId,
    fallback: { x: boardPoint.x, y: boardPoint.y },
  };
}

function renderHoverDots(
  objId: string,
  snapshot: readonly ObjectSnapshot[],
  camera: Camera,
): React.ReactNode {
  const obj = snapshot.find((s) => s.id === objId);
  if (!obj) return null;

  const bounds = objectBounds(obj);
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  // Convert to screen coords
  const screenCx = (cx - camera.x) * camera.zoom;
  const screenCy = (cy - camera.y) * camera.zoom;
  const radius = CONNECTOR_DOT_RADIUS_PX;

  // Four dots at side midpoints in screen space
  const dotPositions = [
    { sx: screenCx, sy: (bounds.y - camera.y) * camera.zoom, side: 'top' as const },       // top midpoint
    { sx: ((bounds.x + bounds.width) - camera.x) * camera.zoom, sy: screenCy, side: 'right' as const },   // right midpoint
    { sx: screenCx, sy: ((bounds.y + bounds.height) - camera.y) * camera.zoom, side: 'bottom' as const },  // bottom midpoint
    { sx: (bounds.x - camera.x) * camera.zoom, sy: screenCy, side: 'left' as const },                 // left midpoint
  ];

  return dotPositions.map((dot, i) => (
    <circle
      key={`dot-${i}`}
      cx={dot.sx}
      cy={dot.sy}
      r={radius}
      fill="#1a73e8"
      stroke="#fff"
      strokeWidth={2}
    />
  ));
}

function renderArrowPreview(from: Point, to: Point): React.ReactNode {
  const sxFrom = (from.x - 0) * 1; // handled by viewBox
  const syFrom = (from.y - 0) * 1;
  const sxTo = (to.x - 0) * 1;
  const syTo = (to.y - 0) * 1;

  return (
    <>
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="#999"
        strokeWidth={2}
        strokeDasharray="6,4"
      />
    </>
  );
}
