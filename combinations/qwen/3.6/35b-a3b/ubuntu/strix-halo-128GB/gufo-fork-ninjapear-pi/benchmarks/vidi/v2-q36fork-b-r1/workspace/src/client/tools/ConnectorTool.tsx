import { useState, useCallback, useRef, type ReactNode } from 'react';
import { screenToWorld, Camera, Point } from '@/client/canvas/camera';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, CONNECTOR_DOT_RADIUS_PX } from '@/shared/config';
import { objectBounds } from '@/shared/board-model';
import { sideAnchor, nearestSide, AttachedEndpoint, FreeEndpoint, Endpoint, Point as GeoPoint, Rect as GeoRect } from '@/shared/geometry/connector-geometry';
import type { ObjectSnapshot as ObjectSnap } from '@/client/objects/registry';

interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnap[];
  onCreated(id: string): void;
}

/** Renders connection dots on objects under cursor while connector tool is active. */
export function ConnectorTool(props: ConnectorToolProps): ReactNode {
  const { camera, snapshot, onCreated: _onCreated } = props; // onCreated handled externally

  const [hoverState, setHoverState] = useState<{
    objectId: string | null;
    targetDotIndex: number | null; // -1 = none, 0=top,1=right,2=bottom,3=left
    draggingFromObjId: string | null;
  }>({ objectId: null, targetDotIndex: null, draggingFromObjId: null });

  const dragStartRef = useRef<{ point: Point; objectId: string | null } | null>(null);
  const isDraggingRef = useRef(false);

  // Hit-test to find which object (if any) the pointer is over
  const hitTestObject = useCallback(
    (worldPt: Point): { id: string; rect: { x: number; y: number; width: number; height: number } } | null => {
      // Iterate in reverse z order (top-most first)
      const sorted = [...snapshot].sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
      for (const obj of sorted) {
        const r = objectBounds(obj);
        if (
          worldPt.x >= r.x && worldPt.y >= r.y &&
          worldPt.x <= r.x + r.width && worldPt.y <= r.y + r.height
        ) {
          return { id: obj.id, rect: r };
        }
      }
      return null;
    },
    [snapshot],
  );

  // Compute the four side-midpoint dot positions
  const sideMidpoints = useCallback((rect: { x: number; y: number; width: number; height: number }): Point[] => {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    return [
      { x: cx, y: rect.y },          // top
      { x: rect.x + rect.width, y: cy }, // right
      { x: cx, y: rect.y + rect.height }, // bottom
      { x: rect.x, y: cy },          // left
    ];
  }, []);

  // Find nearest side index given a direction point
  const nearestSideIndex = useCallback((rect: { x: number; y: number; width: number; height: number }, toward: Point): number => {
    const side = nearestSide(rect as GeoRect, toward as GeoPoint);
    return side === 'top' ? 0 : side === 'right' ? 1 : side === 'bottom' ? 2 : 3;
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current && !dragStartRef.current) return;

      const worldPt = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      const hit = hitTestObject(worldPt);

      if (hit) {
        const midpoints = sideMidpoints(hit.rect);
        let highlighted = -1;

        if (isDraggingRef.current && dragStartRef.current) {
          const dp = dragStartRef.current;
          // Determine which end is being dragged and compute nearest side
          // For simplicity, highlight whichever side is nearest
          highlighted = nearestSideIndex(hit.rect, dp.point);
        } else {
          highlighted = -1;
        }

        setHoverState({
          objectId: hit.id,
          targetDotIndex: highlighted,
          draggingFromObjId: isDraggingRef.current && dragStartRef.current ? dragStartRef.current.objectId : null,
        });
      } else {
        setHoverState({ objectId: null, targetDotIndex: null, draggingFromObjId: null });
      }
    },
    [camera, hitTestObject, sideMidpoints, nearestSideIndex],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const worldPt = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      const hit = hitTestObject(worldPt);

      if (hit) {
        // Start drag from this object
        const anchorEp: AttachedEndpoint = {
          kind: 'attached',
          objectId: hit.id,
          fallback: { x: hit.rect.x + hit.rect.width / 2, y: hit.rect.y + hit.rect.height / 2 },
        };
        dragStartRef.current = { point: anchorEp.fallback, objectId: hit.id };
        isDraggingRef.current = true;
      }
    },
    [camera, hitTestObject],
  );

  const handlePointerUp = useCallback(() => {
    if (!isDraggingRef.current) return;

    // Check final position — could be on an object or empty space
    // In a real implementation, we'd capture the last pointer position
    // For now, just reset state; actual creation happens via the App.tsx handler
    dragStartRef.current = null;
    isDraggingRef.current = false;
    setHoverState({ objectId: null, targetDotIndex: null, draggingFromObjId: null });
  }, []);

  // Render hover dots
  const dots: ReactNode[] = [];
  if (hoverState.objectId && !hoverState.draggingFromObjId) {
    // Show standard 4 dots when hovering
    const hit = snapshot.find(o => o.id === hoverState.objectId);
    if (hit) {
      const rect = objectBounds(hit);
      const mpts = sideMidpoints(rect);
      dots.push(...mpts.map((pt, i) => (
        <circle
          key={`dot-${i}`}
          data-testid={`connector-dot-${hoverState.objectId}-${['top', 'right', 'bottom', 'left'][i]}`}
          cx={pt.x}
          cy={pt.y}
          r={CONNECTOR_DOT_RADIUS_PX / camera.zoom}
          fill="#2979ff"
          opacity={0.8}
        />
      )));
    }
  } else if (hoverState.objectId && hoverState.draggingFromObjId && hoverState.objectId !== hoverState.draggingFromObjId) {
    // Highlight target dot during drag
    const hit = snapshot.find(o => o.id === hoverState.objectId);
    if (hit) {
      const rect = objectBounds(hit);
      const mpts = sideMidpoints(rect);
      const hi = hoverState.targetDotIndex ?? 0;
      dots.push(...mpts.map((pt, i) => (
        <circle
          key={`target-dot-${i}`}
          cx={pt.x}
          cy={pt.y}
          r={(i === hi ? CONNECTOR_DOT_RADIUS_PX * 1.5 : CONNECTOR_DOT_RADIUS_PX) / camera.zoom}
          fill={i === hi ? '#FF6B00' : '#2979ff'}
          opacity={0.9}
        />
      )));
    }
  }

  return (
    <g
      data-testid="connector-tool-layer"
      style={{ transformOrigin: '0 0', transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {dots}
    </g>
  );
}
