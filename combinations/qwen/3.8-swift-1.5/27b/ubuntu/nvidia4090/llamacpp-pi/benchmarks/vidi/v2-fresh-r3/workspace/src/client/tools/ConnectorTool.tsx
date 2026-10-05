import { useCallback, useRef, useState, type JSX } from 'react';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import {
  sideAnchor,
  nearestSide,
  type Side,
} from '../../shared/geometry/connector-geometry';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type * as Y from 'yjs';
import type { UndoController } from '../board/undo';
import type { Rect } from '../../shared/geometry';

export interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  createdBy: string;
  onCreated(id: string): void;
  undo?: UndoController;
}

/** Hit-test: is world point `p` inside the bounds of any object? */
function hitTestObject(snapshot: readonly ObjectSnapshot[], p: Point): ObjectSnapshot | null {
  // Iterate in reverse (topmost first)
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const obj = snapshot[i];
    const r = objectBounds(obj);
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) {
      return obj;
    }
  }
  return null;
}

function sideDots(r: Rect): { side: Side; x: number; y: number }[] {
  return [
    { side: 'top', ...sideAnchor(r, 'top') },
    { side: 'right', ...sideAnchor(r, 'right') },
    { side: 'bottom', ...sideAnchor(r, 'bottom') },
    { side: 'left', ...sideAnchor(r, 'left') },
  ];
}

/**
 * Connector creation tool (connector.ui). Shows hover dots on objects,
 * highlights the target dot while dragging, and creates connectors on release.
 */
export function ConnectorTool(props: ConnectorToolProps): JSX.Element {
  const { camera, snapshot, doc, createdBy, onCreated, undo } = props;

  const [hoverObj, setHoverObj] = useState<ObjectSnapshot | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null); // screen
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null); // screen
  const [targetSide, setTargetSide] = useState<Side | null>(null);
  const [targetObj, setTargetObj] = useState<ObjectSnapshot | null>(null);

  const dragStartRef = useRef<Point | null>(null);
  const dragCurrentRef = useRef<Point | null>(null);
  const dragStartObjRef = useRef<ObjectSnapshot | null>(null);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const p = { x: e.clientX, y: e.clientY };
    const world = screenToWorld(camera, p);

    if (dragStartRef.current) {
      // Dragging
      dragCurrentRef.current = p;
      setDragCurrent(p);

      // Hit-test the target
      const target = hitTestObject(snapshot, world);
      setTargetObj(target);
      if (target) {
        const r = objectBounds(target);
        const side = nearestSide(r, world);
        setTargetSide(side);
      } else {
        setTargetSide(null);
      }
      return;
    }

    // Hovering
    const obj = hitTestObject(snapshot, world);
    setHoverObj(obj);
  }, [camera, snapshot]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = { x: e.clientX, y: e.clientY };
    const world = screenToWorld(camera, p);
    const obj = hitTestObject(snapshot, world);

    dragStartRef.current = p;
    dragCurrentRef.current = p;
    dragStartObjRef.current = obj;
    setDragStart(p);
    setDragCurrent(p);
    setTargetObj(null);
    setTargetSide(null);
  }, [camera, snapshot]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const end = { x: e.clientX, y: e.clientY };
    const start = dragStartRef.current;
    const startObj = dragStartObjRef.current;

    dragStartRef.current = null;
    dragCurrentRef.current = null;
    dragStartObjRef.current = null;
    setDragStart(null);
    setDragCurrent(null);
    setTargetObj(null);
    setTargetSide(null);

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }

    const worldStart = screenToWorld(camera, start);
    const worldEnd = screenToWorld(camera, end);

    // Check minimum length
    const dist = Math.hypot(worldEnd.x - worldStart.x, worldEnd.y - worldStart.y);
    if (dist < CONNECTOR_MIN_LENGTH_WORLD) return;

    // Hit-test the target
    const targetObj = hitTestObject(snapshot, worldEnd);

    // Build endpoints
    let from: Endpoint;
    let to: Endpoint;

    if (startObj) {
      const r = objectBounds(startObj);
      const toward = targetObj ? objectBounds(targetObj) : null;
      const towardPt = toward ? { x: toward.x + toward.width / 2, y: toward.y + toward.height / 2 } : worldEnd;
      const side = nearestSide(r, towardPt);
      const anchor = sideAnchor(r, side);
      from = { kind: 'attached', objectId: startObj.id, fallback: anchor };
    } else {
      from = { kind: 'free', x: worldStart.x, y: worldStart.y };
    }

    if (targetObj) {
      if (startObj && targetObj.id === startObj.id) return; // same object
      const r = objectBounds(targetObj);
      const towardPt = startObj ? { x: objectBounds(startObj).x + objectBounds(startObj).width / 2, y: objectBounds(startObj).y + objectBounds(startObj).height / 2 } : worldStart;
      const side = nearestSide(r, towardPt);
      const anchor = sideAnchor(r, side);
      to = { kind: 'attached', objectId: targetObj.id, fallback: anchor };
    } else {
      to = { kind: 'free', x: worldEnd.x, y: worldEnd.y };
    }

    undo?.boundary();
    const id = createConnector(doc, from, to, createdBy);
    if (id) {
      undo?.boundary();
      onCreated(id);
    }
  }, [camera, snapshot, doc, createdBy, onCreated, undo]);

  const handlePointerCancel = useCallback(() => {
    dragStartRef.current = null;
    dragCurrentRef.current = null;
    dragStartObjRef.current = null;
    setDragStart(null);
    setDragCurrent(null);
    setTargetObj(null);
    setTargetSide(null);
  }, []);

  // Render hover dots
  const hoverDots = hoverObj && !dragStart ? sideDots(objectBounds(hoverObj)) : null;
  // Render target highlight dot
  const targetDot = targetObj && targetSide ? sideAnchor(objectBounds(targetObj), targetSide) : null;

  // Convert world dots to screen for rendering
  const worldToScreenLocal = (p: Point): Point => {
    return {
      x: (p.x - camera.x) * camera.zoom,
      y: (p.y - camera.y) * camera.zoom,
    };
  };

  return (
    <div
      data-testid="connector-tool-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 5,
        cursor: 'crosshair',
        pointerEvents: 'auto',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* Hover dots */}
      {hoverDots?.map((d) => {
        const sp = worldToScreenLocal(d);
        return (
          <div
            key={d.side}
            data-testid={`connector-dot-${d.side}`}
            style={{
              position: 'absolute',
              left: sp.x - CONNECTOR_DOT_RADIUS_PX,
              top: sp.y - CONNECTOR_DOT_RADIUS_PX,
              width: CONNECTOR_DOT_RADIUS_PX * 2,
              height: CONNECTOR_DOT_RADIUS_PX * 2,
              borderRadius: '50%',
              background: '#1A73E8',
              border: '1px solid white',
              pointerEvents: 'none',
            }}
          />
        );
      })}

      {/* Target highlight dot */}
      {targetDot && (() => {
        const sp = worldToScreenLocal(targetDot);
        return (
          <div
            data-testid="connector-target-dot"
            style={{
              position: 'absolute',
              left: sp.x - CONNECTOR_DOT_RADIUS_PX * 1.5,
              top: sp.y - CONNECTOR_DOT_RADIUS_PX * 1.5,
              width: CONNECTOR_DOT_RADIUS_PX * 3,
              height: CONNECTOR_DOT_RADIUS_PX * 3,
              borderRadius: '50%',
              background: '#E53935',
              border: '2px solid white',
              pointerEvents: 'none',
            }}
          />
        );
      })()}

      {/* Drag preview line */}
      {dragStart && dragCurrent && (() => {
        const sp = dragStart;
        const cp = dragCurrent;
        const x1 = sp.x, y1 = sp.y, x2 = cp.x, y2 = cp.y;
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 1) return null;
        return (
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="#1A73E8" strokeWidth={2} strokeDasharray="4 3"
            />
          </svg>
        );
      })()}
    </div>
  );
}
