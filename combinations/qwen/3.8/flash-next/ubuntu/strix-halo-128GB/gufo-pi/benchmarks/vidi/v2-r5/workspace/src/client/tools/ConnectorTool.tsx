import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Endpoint } from '../../shared/objects/connector';
import { nearestSide, sideAnchor } from '../../shared/geometry/connector-geometry';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';

/**
 * ConnectorTool: overlay that shows connection dots on hover, allows dragging arrows
 * between objects or to empty space.
 */
export interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  rects: ReadonlyMap<string, Rect>;
  onCreated(id: string): void;
  /** Hit-test a world point against objects; returns object id or null */
  hitTest(world: Point): string | null;
  /** Create connector endpoint */
  createConnector(from: Endpoint, to: Endpoint): string | null;
}

interface HoverState {
  objectId: string;
}

interface DragState {
  startWorld: Point;
  currentWorld: Point;
  startObjectId: string | null;
  targetObjectId: string | null;
}

export function ConnectorTool({
  camera,
  rects,
  onCreated,
  hitTest,
  createConnector,
}: ConnectorToolProps) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const getRect = useCallback((id: string): Rect | null => {
    return rects.get(id) ?? null;
  }, [rects]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const objId = hitTest(world);

    if (dragRef.current) {
      // Update target during drag
      const target = objId !== dragRef.current.startObjectId ? objId : null;
      const state = { ...dragRef.current, currentWorld: world, targetObjectId: target };
      dragRef.current = state;
      setDrag(state);
    } else {
      // Hover state
      if (objId) {
        setHover({ objectId: objId });
      } else {
        setHover(null);
      }
    }
  }, [camera, hitTest]);

  const handlePointerLeave = useCallback(() => {
    if (!dragRef.current) setHover(null);
  }, []);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const startObj = hitTest(world);
    const state: DragState = {
      startWorld: world,
      currentWorld: world,
      startObjectId: startObj,
      targetObjectId: null,
    };
    dragRef.current = state;
    setDrag(state);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }, [camera, hitTest]);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    const state = dragRef.current;
    dragRef.current = null;
    setDrag(null);

    const endWorld = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const endObjId = hitTest(endWorld);

    // Check: same object → no arrow
    if (state.startObjectId && endObjId && state.startObjectId === endObjId) return;

    // Check: too short → no arrow
    const startPt = state.startObjectId
      ? (() => {
          const r = getRect(state.startObjectId!);
          return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : state.startWorld;
        })()
      : state.startWorld;
    const endPt = endObjId
      ? (() => {
          const r = getRect(endObjId);
          return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : endWorld;
        })()
      : endWorld;
    const dx = endPt.x - startPt.x;
    const dy = endPt.y - startPt.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < CONNECTOR_MIN_LENGTH_WORLD) return;

    // Build endpoints
    let from: Endpoint;
    if (state.startObjectId) {
      const r = getRect(state.startObjectId);
      if (r) {
        const side = nearestSide(r, endWorld);
        const anchor = sideAnchor(r, side);
        from = { kind: 'attached', objectId: state.startObjectId, fallback: anchor };
      } else {
        from = { kind: 'free', x: state.startWorld.x, y: state.startWorld.y };
      }
    } else {
      from = { kind: 'free', x: state.startWorld.x, y: state.startWorld.y };
    }

    let to: Endpoint;
    if (endObjId) {
      const r = getRect(endObjId);
      if (r) {
        const side = nearestSide(r, state.startWorld);
        const anchor = sideAnchor(r, side);
        to = { kind: 'attached', objectId: endObjId, fallback: anchor };
      } else {
        to = { kind: 'free', x: endWorld.x, y: endWorld.y };
      }
    } else {
      to = { kind: 'free', x: endWorld.x, y: endWorld.y };
    }

    const id = createConnector(from, to);
    if (id) {
      onCreated(id);
    }
  }, [camera, hitTest, getRect, createConnector, onCreated]);

  const handlePointerCancel = useCallback(() => {
    dragRef.current = null;
    setDrag(null);
  }, []);

  // Render hover dots for the hovered object
  const hoverDots = (() => {
    const targetId = drag?.targetObjectId ?? hover?.objectId;
    if (!targetId) return null;
    const r = getRect(targetId);
    if (!r) return null;

    const dotR = CONNECTOR_DOT_RADIUS_PX / camera.zoom;
    const dots: { x: number; y: number; side: string; highlighted: boolean }[] = [];

    const sides = [
      { side: 'top', point: sideAnchor(r, 'top') },
      { side: 'right', point: sideAnchor(r, 'right') },
      { side: 'bottom', point: sideAnchor(r, 'bottom') },
      { side: 'left', point: sideAnchor(r, 'left') },
    ];

    // Determine which side is highlighted (the nearest to the other end of the drag)
    const otherPoint = drag
      ? (drag.startObjectId ? (() => {
          const sr = getRect(drag.startObjectId);
          return sr ? { x: sr.x + sr.width / 2, y: sr.y + sr.height / 2 } : drag.startWorld;
        })() : drag.startWorld)
      : null;

    const highlightedSide = otherPoint ? nearestSide(r, otherPoint) : null;

    for (const { side, point } of sides) {
      dots.push({ x: point.x, y: point.y, side, highlighted: side === highlightedSide });
    }
    return { dots, r: dotR };
  })();

  // Drag preview line
  const previewLine = (() => {
    if (!drag) return null;
    const startPt = drag.startObjectId
      ? (() => {
          const r = getRect(drag.startObjectId);
          return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : drag.startWorld;
        })()
      : drag.startWorld;
    const endPt = drag.targetObjectId
      ? (() => {
          const r = getRect(drag.targetObjectId);
          return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : drag.currentWorld;
        })()
      : drag.currentWorld;
    return { from: startPt, to: endPt };
  })();

  return (
    <div
      data-testid="connector-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        pointerEvents: 'auto',
        zIndex: 5,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
    >
      <svg
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        {/* Hover dots */}
        {hoverDots && hoverDots.dots.map((d) => (
          <circle
            key={d.side}
            cx={d.x}
            cy={d.y}
            r={hoverDots.r}
            fill={d.highlighted ? '#1E88E5' : '#90CAF9'}
            stroke={d.highlighted ? '#0D47A1' : '#42A5F5'}
            strokeWidth={1 / camera.zoom}
            data-testid={`connector-dot-${d.side}`}
            data-highlighted={d.highlighted}
          />
        ))}
        {/* Drag preview line */}
        {previewLine && (
          <line
            x1={previewLine.from.x}
            y1={previewLine.from.y}
            x2={previewLine.to.x}
            y2={previewLine.to.y}
            stroke="#1E88E5"
            strokeWidth={2 / camera.zoom}
            strokeDasharray={`${4 / camera.zoom}`}
          />
        )}
      </svg>
    </div>
  );
}
