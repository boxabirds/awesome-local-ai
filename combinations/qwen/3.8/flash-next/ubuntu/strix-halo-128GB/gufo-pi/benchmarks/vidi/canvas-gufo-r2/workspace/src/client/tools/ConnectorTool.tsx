/**
 * Connector tool (story 10, connector.ui).
 *
 * Screen-space overlay that captures pointer events when the Connector tool is
 * active. Handles hover dots, drag-to-create with preview line, and creates
 * attached or free endpoints on release.
 *
 * Uses native event listeners (not React synthetic events) for pointermove to
 * ensure correct behavior in jsdom tests.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { Camera } from '../canvas/camera';
import {
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
} from '../../shared/config';
import { screenToWorld } from '../canvas/camera';
import type { Point, Rect } from '../../shared/geometry';
import { nearestSide, sideAnchor } from '../../shared/geometry/connector-geometry';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import type { ObjectSnapshot } from '../../shared/board-model';
import type * as Y from 'yjs';

export interface ConnectorToolProps {
  camera: Camera;
  doc: Y.Doc;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  onCreated(id: string): void;
  getBoardRect(): DOMRect | null;
}

interface DragState {
  startWorld: Point;
  currentScreen: Point;
  startObject: ObjectSnapshot | null;
}

export function ConnectorTool(props: ConnectorToolProps): JSX.Element {
  const { camera, doc, snapshot, canEdit, onCreated, getBoardRect } = props;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverObj, setHoverObj] = useState<ObjectSnapshot | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Store latest state/props in refs so the native listener closure is always current.
  const latestRef = useRef({ camera, snapshot, getBoardRect, hitTestObject: null as ((p: Point) => ObjectSnapshot | null) | null, drag: drag as DragState | null });

  const getScreenPoint = useCallback((clientX: number, clientY: number): Point => {
    const boardRect = getBoardRect();
    if (!boardRect) return { x: clientX, y: clientY };
    return { x: clientX - boardRect.left, y: clientY - boardRect.top };
  }, [getBoardRect]);

  const toWorld = useCallback((screenPt: Point): Point => {
    return screenToWorld(camera, screenPt);
  }, [camera]);

  const hitTestObject = useCallback((worldPt: Point): ObjectSnapshot | null => {
    for (let i = snapshot.length - 1; i >= 0; i--) {
      const o = snapshot[i];
      if (o.type === 'connector') continue;
      const w = o.width ?? 200;
      const h = o.height ?? 200;
      if (worldPt.x >= o.x && worldPt.x <= o.x + w && worldPt.y >= o.y && worldPt.y <= o.y + h) {
        return o;
      }
    }
    return null;
  }, [snapshot]);

  // Keep latestRef up to date
  latestRef.current = { camera, snapshot, getBoardRect, hitTestObject, drag };

  // Native pointermove listener (React synthetic onPointerMove is unreliable in jsdom)
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const handleMove = (e: PointerEvent) => {
      const latest = latestRef.current;
      const sp = { x: e.clientX, y: e.clientY };
      const boardRect = latest.getBoardRect();
      const relSp = boardRect ? { x: sp.x - boardRect.left, y: sp.y - boardRect.top } : sp;
      const wp = screenToWorld(latest.camera, relSp);

      if (pointerIdRef.current === e.pointerId) {
        // Dragging
        setDrag((prev) => prev ? { ...prev, currentScreen: relSp } : prev);
      } else {
        // Hover
        const target = latest.hitTestObject?.(wp) ?? null;
        setHoverObj(target);
      }
    };

    el.addEventListener('pointermove', handleMove);
    return () => el.removeEventListener('pointermove', handleMove);
  }, []); // mount once; reads latestRef

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!canEdit) return;
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture(e.pointerId); } catch { /* best effort */ }
    pointerIdRef.current = e.pointerId;
    const sp = getScreenPoint(e.clientX, e.clientY);
    const wp = toWorld(sp);
    const target = hitTestObject(wp);
    setDrag({ startWorld: wp, currentScreen: sp, startObject: target });
  }, [canEdit, getScreenPoint, toWorld, hitTestObject]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    const el = e.currentTarget as HTMLElement;
    try { el.releasePointerCapture(e.pointerId); } catch { /* best effort */ }

    if (!drag) { setDrag(null); return; }

    const sp = getScreenPoint(e.clientX, e.clientY);
    const endWorld = toWorld(sp);
    const endObject = hitTestObject(endWorld);

    // Reject: same object or too short
    const length = Math.hypot(endWorld.x - drag.startWorld.x, endWorld.y - drag.startWorld.y);
    if (drag.startObject && endObject && drag.startObject.id === endObject.id) {
      setDrag(null);
      return;
    }
    if (length < CONNECTOR_MIN_LENGTH_WORLD) {
      setDrag(null);
      return;
    }

    // Build endpoints with fallbacks
    let fromEp: Endpoint;
    if (drag.startObject) {
      const r: Rect = { x: drag.startObject.x, y: drag.startObject.y, width: drag.startObject.width ?? 200, height: drag.startObject.height ?? 200 };
      const side = nearestSide(r, endWorld);
      const anchor = sideAnchor(r, side);
      fromEp = { kind: 'attached', objectId: drag.startObject.id, fallback: anchor };
    } else {
      fromEp = { kind: 'free', x: drag.startWorld.x, y: drag.startWorld.y };
    }

    let toEp: Endpoint;
    if (endObject) {
      const r: Rect = { x: endObject.x, y: endObject.y, width: endObject.width ?? 200, height: endObject.height ?? 200 };
      const side = nearestSide(r, drag.startWorld);
      const anchor = sideAnchor(r, side);
      toEp = { kind: 'attached', objectId: endObject.id, fallback: anchor };
    } else {
      toEp = { kind: 'free', x: endWorld.x, y: endWorld.y };
    }

    const id = createConnector(doc, fromEp, toEp, 'user');
    setDrag(null);

    if (id) {
      onCreated(id);
    }
  }, [drag, doc, canEdit, getScreenPoint, toWorld, hitTestObject, onCreated]);

  const onPointerCancel = useCallback(() => {
    pointerIdRef.current = null;
    setDrag(null);
  }, []);

  // Build rects map for hover dot rendering
  const getObjectRect = useCallback((o: ObjectSnapshot): Rect => {
    return { x: o.x, y: o.y, width: o.width ?? 200, height: o.height ?? 200 };
  }, []);

  // Render hover dots for the hovered object
  let dots: JSX.Element | null = null;
  if (hoverObj && !drag) {
    const r = getObjectRect(hoverObj);
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    dots = (
      <div style={{
        position: 'absolute', left: 0, top: 0,
        transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
        transformOrigin: '0 0', width: 0, height: 0, pointerEvents: 'none',
      }}>
        {sides.map((side) => {
          const anchor = sideAnchor(r, side);
          return (
            <div
              key={side}
              data-connector-dot={side}
              data-target-id={hoverObj.id}
              style={{
                position: 'absolute',
                left: `${anchor.x - CONNECTOR_DOT_RADIUS_PX / camera.zoom}px`,
                top: `${anchor.y - CONNECTOR_DOT_RADIUS_PX / camera.zoom}px`,
                width: `${(CONNECTOR_DOT_RADIUS_PX * 2) / camera.zoom}px`,
                height: `${(CONNECTOR_DOT_RADIUS_PX * 2) / camera.zoom}px`,
                borderRadius: '50%',
                backgroundColor: '#4A90D9',
                border: `${1 / camera.zoom}px solid white`,
              }}
            />
          );
        })}
      </div>
    );
  }

  // Render highlight dot and preview line during drag
  let dragPreview: JSX.Element | null = null;
  if (drag) {
    const endWorld = toWorld(drag.currentScreen);
    const endObject = hitTestObject(endWorld);

    dragPreview = (
      <div style={{
        position: 'absolute', left: 0, top: 0,
        transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
        transformOrigin: '0 0', width: 0, height: 0, pointerEvents: 'none',
      }}>
        <svg style={{ position: 'absolute', overflow: 'visible', width: 0, height: 0 }}>
          <line
            x1={drag.startWorld.x} y1={drag.startWorld.y}
            x2={endWorld.x} y2={endWorld.y}
            stroke="#4A90D9" strokeWidth={2 / camera.zoom} strokeDasharray={`${4 / camera.zoom} ${4 / camera.zoom}`}
          />
        </svg>
        {endObject && (() => {
          const r = getObjectRect(endObject);
          const side = nearestSide(r, drag.startWorld);
          const anchor = sideAnchor(r, side);
          return (
            <div
              data-connector-highlight={side}
              style={{
                position: 'absolute',
                left: `${anchor.x - (CONNECTOR_DOT_RADIUS_PX + 2) / camera.zoom}px`,
                top: `${anchor.y - (CONNECTOR_DOT_RADIUS_PX + 2) / camera.zoom}px`,
                width: `${(CONNECTOR_DOT_RADIUS_PX + 2) * 2 / camera.zoom}px`,
                height: `${(CONNECTOR_DOT_RADIUS_PX + 2) * 2 / camera.zoom}px`,
                borderRadius: '50%',
                backgroundColor: '#FF9800',
                border: `${1 / camera.zoom}px solid white`,
              }}
            />
          );
        })()}
      </div>
    );
  }

  return (
    <div
      ref={overlayRef}
      className="connector-tool-overlay"
      data-testid="connector-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 9999,
        cursor: 'crosshair',
        pointerEvents: 'auto',
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {dots}
      {dragPreview}
    </div>
  );
}
