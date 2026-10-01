/**
 * ConnectorTool (story 10): hover dots, drag preview, creation.
 */
import React, { useRef, useCallback, useState } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Point, Rect } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { sideAnchor, nearestSide } from '../../shared/geometry/connector-geometry';
import type { Side } from '../../shared/geometry/connector-geometry';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import { DRAG_THRESHOLD_PX } from '../../shared/config';

export interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  onCreated(id: string): void;
  /** Called to actually create the connector. Return id or null. */
  createConnector(from: any, to: any): string | null;
}

interface HoverInfo {
  objectId: string;
  rect: Rect;
  dots: { side: Side; point: Point }[];
}

export function ConnectorTool({ camera, snapshot, onCreated, createConnector }: ConnectorToolProps) {
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragFrom, setDragFrom] = useState<Point | null>(null);
  const [dragTo, setDragTo] = useState<Point | null>(null);
  const [highlightedSide, setHighlightedSide] = useState<Side | null>(null);

  const startScreenRef = useRef<Point | null>(null);
  const startObjectIdRef = useRef<string | null>(null);
  const draggingRef = useRef(false);

  // Build rects map from snapshot
  const rectsMap = new Map<string, Rect>();
  for (const obj of snapshot) {
    if (obj.type === 'connector') continue;
    rectsMap.set(obj.id, objectBounds(obj));
  }

  /** Hit-test world point against objects (excluding connectors) */
  const hitTest = useCallback((worldPoint: Point): { id: string; rect: Rect } | null => {
    // Iterate in reverse z-order for topmost first
    for (let i = snapshot.length - 1; i >= 0; i--) {
      const obj = snapshot[i];
      if (obj.type === 'connector') continue;
      const r = objectBounds(obj);
      if (worldPoint.x >= r.x && worldPoint.x <= r.x + r.width &&
          worldPoint.y >= r.y && worldPoint.y <= r.y + r.height) {
        return { id: obj.id, rect: r };
      }
    }
    return null;
  }, [snapshot]);

  const getPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    return { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const screenPt = getPoint(e);
      const worldPt = screenToWorld(camera, screenPt);

      if (draggingRef.current) {
        setDragTo(worldPt);
        // Check if over a target object
        const target = hitTest(worldPt);
        if (target && target.id !== startObjectIdRef.current) {
          const side = nearestSide(target.rect, worldPt);
          setHighlightedSide(side);
          setHover({
            objectId: target.id,
            rect: target.rect,
            dots: getSideDots(target.rect),
          });
        } else {
          setHighlightedSide(null);
        }
        return;
      }

      // Hover: show dots if over an object
      const hit = hitTest(worldPt);
      if (hit) {
        setHover({
          objectId: hit.id,
          rect: hit.rect,
          dots: getSideDots(hit.rect),
        });
      } else {
        setHover(null);
      }
    },
    [camera, getPoint, hitTest],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);

      const screenPt = getPoint(e);
      const worldPt = screenToWorld(camera, screenPt);
      startScreenRef.current = screenPt;
      draggingRef.current = true;
      setDragging(true);
      setDragFrom(worldPt);
      setDragTo(worldPt);

      // Check if started on an object
      const hit = hitTest(worldPt);
      startObjectIdRef.current = hit ? hit.id : null;
    },
    [camera, getPoint, hitTest],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);

      const screenPt = getPoint(e);
      const worldPt = screenToWorld(camera, screenPt);
      const start = startScreenRef.current;

      // Check if moved enough in screen pixels
      if (start) {
        const screenDist = Math.hypot(screenPt.x - start.x, screenPt.y - start.y);
        if (screenDist < DRAG_THRESHOLD_PX) {
          reset();
          return;
        }
      }

      // Check length in world units
      const worldStart = screenToWorld(camera, start!);
      const length = Math.hypot(worldPt.x - worldStart.x, worldPt.y - worldStart.y);
      if (length < CONNECTOR_MIN_LENGTH_WORLD) {
        reset();
        return;
      }

      // Determine from endpoint
      const startObjId = startObjectIdRef.current;
      const from: any = startObjId
        ? { kind: 'attached', objectId: startObjId, fallback: { x: worldStart.x, y: worldStart.y } }
        : { kind: 'free', x: worldStart.x, y: worldStart.y };

      // Determine to endpoint
      const target = hitTest(worldPt);
      let to: any;

      if (target && target.id !== startObjId) {
        to = { kind: 'attached', objectId: target.id, fallback: { x: worldPt.x, y: worldPt.y } };
      } else if (target && target.id === startObjId) {
        // Same object: no arrow
        reset();
        return;
      } else {
        to = { kind: 'free', x: worldPt.x, y: worldPt.y };
      }

      const id = createConnector(from, to);
      if (id) {
        onCreated(id);
      }
      reset();
    },
    [camera, getPoint, hitTest, createConnector, onCreated],
  );

  function reset() {
    setDragging(false);
    setDragFrom(null);
    setDragTo(null);
    setHighlightedSide(null);
    startScreenRef.current = null;
    startObjectIdRef.current = null;
    draggingRef.current = false;
  }

  const handlePointerCancel = useCallback(() => {
    reset();
  }, []);

  // Render drag line
  const renderDragLine = () => {
    if (!dragging || !dragFrom || !dragTo) return null;
    const fromScreen = worldToScreen(dragFrom, camera);
    const toScreen = worldToScreen(dragTo, camera);
    return (
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}
      >
        <line
          x1={fromScreen.x}
          y1={fromScreen.y}
          x2={toScreen.x}
          y2={toScreen.y}
          stroke="#1976D2"
          strokeWidth={2}
          strokeDasharray="6 3"
        />
      </svg>
    );
  };

  // Render hover dots
  const renderDots = () => {
    if (!hover) return null;
    return (
      <div data-testid="connector-dots" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
        {hover.dots.map((d) => {
          const screen = worldToScreen(d.point, camera);
          const isHighlighted = dragging && highlightedSide === d.side;
          return (
            <div
              key={d.side}
              data-testid={`connector-dot-${d.side}`}
              data-highlighted={isHighlighted ? 'true' : 'false'}
              style={{
                position: 'absolute',
                left: screen.x - CONNECTOR_DOT_RADIUS_PX,
                top: screen.y - CONNECTOR_DOT_RADIUS_PX,
                width: CONNECTOR_DOT_RADIUS_PX * 2,
                height: CONNECTOR_DOT_RADIUS_PX * 2,
                borderRadius: '50%',
                backgroundColor: isHighlighted ? '#1976D2' : '#90CAF9',
                border: '1px solid #1976D2',
              }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div
      data-testid="connector-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {renderDots()}
      {renderDragLine()}
    </div>
  );
}

function getSideDots(r: Rect): { side: Side; point: Point }[] {
  return [
    { side: 'top', point: sideAnchor(r, 'top') },
    { side: 'right', point: sideAnchor(r, 'right') },
    { side: 'bottom', point: sideAnchor(r, 'bottom') },
    { side: 'left', point: sideAnchor(r, 'left') },
  ];
}

function worldToScreen(p: Point, cam: Camera): Point {
  return {
    x: (p.x - cam.x) * cam.zoom,
    y: (p.y - cam.y) * cam.zoom,
  };
}
