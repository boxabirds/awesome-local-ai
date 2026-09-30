/**
 * Story 10: Connector tool — hover dots, drag preview, creation.
 */
import { useRef, useState, useCallback } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import {
  CONNECTOR_MIN_LENGTH_WORLD, CONNECTOR_DOT_RADIUS_PX,
} from '@shared/config';
import { createConnector, type Endpoint } from '@shared/objects/connector';
import { sideAnchor, nearestSide } from '@shared/geometry/connector-geometry';
import type { ObjectSnapshot } from '@shared/board-model';
import type { Rect } from '@shared/geometry';
import * as Y from 'yjs';

interface ConnectorToolProps {
  camera: Camera;
  doc: Y.Doc;
  snapshot: readonly ObjectSnapshot[];
  createdBy: string;
  onCreated: (id: string) => void;
}

function getObjRect(obj: ObjectSnapshot): Rect {
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
}

function hitTestObject(snapshot: readonly ObjectSnapshot[], worldPt: Point): ObjectSnapshot | null {
  // Iterate in reverse (topmost first)
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const obj = snapshot[i];
    if (obj.type === 'connector') continue; // Don't hit-test connectors
    const r = getObjRect(obj);
    if (worldPt.x >= r.x && worldPt.x <= r.x + r.width &&
        worldPt.y >= r.y && worldPt.y <= r.y + r.height) {
      return obj;
    }
  }
  return null;
}

export function ConnectorTool({ camera, doc, snapshot, createdBy, onCreated }: ConnectorToolProps) {
  const [hoverObj, setHoverObj] = useState<ObjectSnapshot | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragEnd, setDragEnd] = useState<Point | null>(null);
  const [dragStartObj, setDragStartObj] = useState<ObjectSnapshot | null>(null);
  const [highlightSide, setHighlightSide] = useState<string | null>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<Point | null>(null);
  const dragStartObjRef = useRef<ObjectSnapshot | null>(null);

  const getPoint = useCallback((e: React.PointerEvent): Point => {
    // The overlay covers the full viewport, so clientX/clientY are the
    // viewport-relative coordinates directly.
    return { x: e.clientX, y: e.clientY };
  }, []);

  const getWorldPoint = useCallback((screenPt: Point): Point => {
    return screenToWorld(camera, screenPt);
  }, [camera]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const pt = getPoint(e);
    const worldPt = getWorldPoint(pt);

    if (draggingRef.current) {
      setDragEnd(pt);
      // Highlight the target's nearest side
      const target = hitTestObject(snapshot, worldPt);
      if (target && dragStartObj && target.id !== dragStartObj.id) {
        const rect = getObjRect(target);
        const side = nearestSide(rect, getWorldPoint(dragStart!));
        setHighlightSide(side);
      } else {
        setHighlightSide(null);
      }
      return;
    }

    // Hover: show dots on the object under the pointer
    const obj = hitTestObject(snapshot, worldPt);
    setHoverObj(obj);
  }, [getPoint, getWorldPoint, snapshot, dragStart, dragStartObj]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button) return;
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    const pt = getPoint(e);
    const worldPt = getWorldPoint(pt);
    const obj = hitTestObject(snapshot, worldPt);

    draggingRef.current = true;
    dragStartRef.current = pt;
    dragStartObjRef.current = obj;
    setDragStart(pt);
    setDragEnd(pt);
    setDragStartObj(obj);
  }, [getPoint, getWorldPoint, snapshot]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;

    const end = getPoint(e);
    const start = dragStartRef.current;
    const startObj = dragStartObjRef.current;
    dragStartRef.current = null;
    dragStartObjRef.current = null;
    setDragStart(null);
    setDragEnd(null);
    setDragStartObj(null);
    setHighlightSide(null);

    if (!start) return;

    const worldStart = getWorldPoint(start);
    const worldEnd = getWorldPoint(end);

    // Check minimum length
    const length = Math.hypot(worldEnd.x - worldStart.x, worldEnd.y - worldStart.y);
    if (length < CONNECTOR_MIN_LENGTH_WORLD) return;

    const endObj = hitTestObject(snapshot, worldEnd);

    // Build endpoints
    let from: Endpoint;
    let to: Endpoint;

    if (startObj) {
      from = {
        kind: 'attached',
        objectId: startObj.id,
        fallback: { ...worldStart },
      };
    } else {
      from = { kind: 'free', x: worldStart.x, y: worldStart.y };
    }

    if (endObj) {
      // Reject if same object
      if (startObj && endObj.id === startObj.id) return;
      to = {
        kind: 'attached',
        objectId: endObj.id,
        fallback: { ...worldEnd },
      };
    } else {
      to = { kind: 'free', x: worldEnd.x, y: worldEnd.y };
    }

    const id = createConnector(doc, from, to, createdBy);
    if (id) {
      onCreated(id);
    }
  }, [getPoint, getWorldPoint, snapshot, doc, createdBy, onCreated]);

  const handlePointerCancel = useCallback(() => {
    draggingRef.current = false;
    setDragStart(null);
    setDragEnd(null);
    setDragStartObj(null);
    setHighlightSide(null);
  }, []);

  // Render dots for the hovered object
  const renderDots = (obj: ObjectSnapshot, highlight?: string | null) => {
    const rect = getObjRect(obj);
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    return sides.map((side) => {
      const anchor = sideAnchor(rect, side);
      const isHighlighted = highlight === side;
      return (
        <circle
          key={side}
          data-testid={`conn-dot-${side}`}
          cx={anchor.x}
          cy={anchor.y}
          r={CONNECTOR_DOT_RADIUS_PX / camera.zoom}
          fill={isHighlighted ? '#2196F3' : 'rgba(33,150,243,0.5)'}
          stroke="#fff"
          strokeWidth={1 / camera.zoom}
        />
      );
    });
  };

  // Render drag preview line
  const renderPreview = () => {
    if (!dragStart || !dragEnd) return null;
    const wp1 = getWorldPoint(dragStart);
    const wp2 = getWorldPoint(dragEnd);
    return (
      <line
        x1={wp1.x} y1={wp1.y}
        x2={wp2.x} y2={wp2.y}
        stroke="#2196F3"
        strokeWidth={2 / camera.zoom}
        strokeDasharray={`${4 / camera.zoom}`}
      />
    );
  };

  return (
    <div
      data-testid="connector-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        zIndex: 100,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* The dots and preview are rendered in screen space via the world layer */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        <g
          style={{
            transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
            transformOrigin: '0 0',
          }}
        >
          {hoverObj && !draggingRef.current && renderDots(hoverObj)}
          {dragStartObj && draggingRef.current && renderDots(dragStartObj)}
          {dragEnd && draggingRef.current && (() => {
            const worldEnd = getWorldPoint(dragEnd);
            const target = hitTestObject(snapshot, worldEnd);
            if (target && dragStartObj && target.id !== dragStartObj.id) {
              return renderDots(target, highlightSide);
            }
            return null;
          })()}
          {renderPreview()}
        </g>
      </svg>
    </div>
  );
}
