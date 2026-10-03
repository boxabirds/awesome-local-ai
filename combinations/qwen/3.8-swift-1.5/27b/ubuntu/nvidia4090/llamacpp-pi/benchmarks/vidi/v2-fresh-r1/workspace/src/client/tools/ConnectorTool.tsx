// Connector tool: hover dots, drag preview, creation (story 10).

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_DOT_RADIUS_PX,
} from '../../shared/config';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import { nearestSide, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import type { Rect, Point } from '../../shared/geometry';
import type * as Y from 'yjs';

interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  onCreated(id: string): void;
  onBoundary?: () => void;
}

/** Get the rect of an object from the snapshot. */
function getObjRect(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? 200,
    height: obj.height ?? 200,
  };
}

/** Hit test: find the object under a world point. */
function hitTestObject(snapshot: readonly ObjectSnapshot[], p: Point): ObjectSnapshot | null {
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const obj = snapshot[i];
    if (obj.type === 'connector') continue; // don't hit-test connectors
    const r = getObjRect(obj);
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) {
      return obj;
    }
  }
  return null;
}

interface HoverState {
  objectId: string;
  rect: Rect;
}

interface DragState {
  startWorld: Point;
  startObject: ObjectSnapshot | null;
  endWorld: Point;
  endObject: ObjectSnapshot | null;
}

export function ConnectorTool({ camera, snapshot, doc, onCreated, onBoundary }: ConnectorToolProps): React.ReactElement {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // Use raw clientX/clientY (screen coords) — screenToWorld handles the camera.
    const worldPt = screenToWorld(camera, { x: e.clientX, y: e.clientY });

    if (drag) {
      // During drag: update end position and hit-test
      const endObj = hitTestObject(snapshot, worldPt);
      setDrag((prev) => prev ? { ...prev, endWorld: worldPt, endObject: endObj } : null);
      setHover(null);
    } else {
      // Hovering: show dots on the object under the pointer
      const obj = hitTestObject(snapshot, worldPt);
      if (obj) {
        setHover({ objectId: obj.id, rect: getObjRect(obj) });
      } else {
        setHover(null);
      }
    }
  }, [camera, snapshot, drag]);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
    const worldPt = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const startObj = hitTestObject(snapshot, worldPt);

    setDrag({
      startWorld: worldPt,
      startObject: startObj,
      endWorld: worldPt,
      endObject: startObj,
    });
    setHover(null);
  }, [camera, snapshot]);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    e.stopPropagation();
    const state = drag;
    setDrag(null);

    const startObj = state.startObject;
    const endObj = state.endObject;

    // Rejection: same object or too short
    if (startObj && endObj && startObj.id === endObj.id) {
      return; // same object: no arrow
    }
    const len = Math.hypot(state.endWorld.x - state.startWorld.x, state.endWorld.y - state.startWorld.y);
    if (len < 8) {
      return; // too short: no arrow
    }

    // Build endpoints
    const from: Endpoint = startObj
      ? { kind: 'attached', objectId: startObj.id, fallback: state.startWorld }
      : { kind: 'free', x: state.startWorld.x, y: state.startWorld.y };

    const to: Endpoint = endObj
      ? { kind: 'attached', objectId: endObj.id, fallback: state.endWorld }
      : { kind: 'free', x: state.endWorld.x, y: state.endWorld.y };

    onBoundary?.();
    const id = createConnector(doc, from, to, 'local');
    onBoundary?.();

    if (id) {
      onCreated(id);
    }
  }, [drag, doc, onCreated, onBoundary]);

  const handlePointerCancel = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setDrag(null);
  }, []);

  // Compute the highlighted side during drag
  let highlightedSide: Side | null = null;
  if (drag?.endObject) {
    const rect = getObjRect(drag.endObject);
    const aim = drag.startObject
      ? getObjRect(drag.startObject)
      : { x: drag.startWorld.x, y: drag.startWorld.y, width: 0, height: 0 };
    const aimCenter = { x: aim.x + aim.width / 2, y: aim.y + aim.height / 2 };
    highlightedSide = nearestSide(rect, aimCenter);
  }

  return (
    <div
      ref={ref}
      data-testid="connector-tool"
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'crosshair',
        pointerEvents: 'auto',
        zIndex: 10,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* Hover dots (rendered in screen space) */}
      {hover && !drag && (
        <>
          {(['top', 'right', 'bottom', 'left'] as Side[]).map((side) => {
            const anchor = sideAnchor(hover.rect, side);
            const screen = worldToScreen(camera, anchor);
            return (
              <div
                key={side}
                data-testid={`connector-dot-${side}`}
                style={{
                  position: 'absolute',
                  left: screen.x - CONNECTOR_DOT_RADIUS_PX,
                  top: screen.y - CONNECTOR_DOT_RADIUS_PX,
                  width: CONNECTOR_DOT_RADIUS_PX * 2,
                  height: CONNECTOR_DOT_RADIUS_PX * 2,
                  borderRadius: '50%',
                  backgroundColor: '#1976D2',
                  pointerEvents: 'none',
                }}
              />
            );
          })}
        </>
      )}

      {/* Drag preview line (rendered in screen space) */}
      {drag && (
        <svg
          data-testid="connector-preview"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          <line
            x1={worldToScreen(camera, drag.startWorld).x}
            y1={worldToScreen(camera, drag.startWorld).y}
            x2={worldToScreen(camera, drag.endWorld).x}
            y2={worldToScreen(camera, drag.endWorld).y}
            stroke="#1976D2"
            strokeWidth={2}
            strokeDasharray="4,4"
          />
        </svg>
      )}

      {/* Highlighted target dot during drag (screen space) */}
      {drag?.endObject && highlightedSide && (
        (() => {
          const rect = getObjRect(drag.endObject);
          const anchor = sideAnchor(rect, highlightedSide);
          const screen = worldToScreen(camera, anchor);
          return (
            <div
              data-testid="connector-dot-highlighted"
              style={{
                position: 'absolute',
                left: screen.x - CONNECTOR_DOT_RADIUS_PX - 2,
                top: screen.y - CONNECTOR_DOT_RADIUS_PX - 2,
                width: (CONNECTOR_DOT_RADIUS_PX + 2) * 2,
                height: (CONNECTOR_DOT_RADIUS_PX + 2) * 2,
                borderRadius: '50%',
                backgroundColor: '#E53935',
                pointerEvents: 'none',
              }}
            />
          );
        })()
      )}
    </div>
  );
}
