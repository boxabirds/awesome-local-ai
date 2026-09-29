import React, { useCallback, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '@client/canvas/camera';
import { screenToWorld } from '@client/canvas/camera';
import { createConnector, type Endpoint } from '@shared/objects/connector';
import { objectBounds, type ObjectSnapshot } from '@shared/board-model';
import type { Rect } from '@shared/geometry';
import { nearestSide, sideAnchor } from '@shared/geometry/connector-geometry';

export interface ConnectorToolProps {
  camera: Camera;
  doc: Y.Doc;
  snapshot: readonly ObjectSnapshot[];
  /** Called with the new id after a connector is committed; the host selects it and returns to Select. */
  onCreated(id: string): void;
}

interface DragState {
  from: Endpoint;
  fromPoint: Point;
  current: Point;
  target: { id: string; rect: Rect } | null;
}

/** Topmost object whose bounds contain p, ignoring connectors. */
function objectAt(snapshot: readonly ObjectSnapshot[], p: Point): { id: string; rect: Rect } | null {
  let best: { id: string; rect: Rect } | null = null;
  for (const obj of snapshot) {
    if (obj.type === 'connector') continue;
    const b = objectBounds(obj);
    if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) {
      if (!best || obj.z >= 0) best = { id: obj.id, rect: b };
    }
  }
  return best;
}

function anchorFor(rect: Rect, toward: Point): Point {
  return sideAnchor(rect, nearestSide(rect, toward));
}

/**
 * Full-viewport overlay while the Connector (arrow) tool is active.
 * Hovering an object reveals its four attach dots; the dot nearest the pointer is
 * the snap target. A press-and-drag draws a rubber-band line; releasing over an
 * object attaches that end, releasing over empty space leaves a free end.
 * Releasing on the start object (or too short) creates nothing and keeps the tool active.
 */
export function ConnectorTool(props: ConnectorToolProps): React.ReactElement {
  const { camera, doc, snapshot, onCreated } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ id: string; rect: Rect } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = rootRef.current?.getBoundingClientRect();
      return screenToWorld(camera, { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) });
    },
    [camera],
  );

  const startEndpointFor = useCallback(
    (p: Point): { endpoint: Endpoint; anchor: Point } => {
      const hit = objectAt(snapshot, p);
      if (hit) {
        const a = anchorFor(hit.rect, p);
        return { endpoint: { kind: 'attached', objectId: hit.id, fallback: a }, anchor: a };
      }
      return { endpoint: { kind: 'free', x: p.x, y: p.y }, anchor: p };
    },
    [snapshot],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const p = toWorld(e.clientX, e.clientY);
      const start = startEndpointFor(p);
      const d: DragState = { from: start.endpoint, fromPoint: start.anchor, current: p, target: null };
      dragRef.current = d;
      setDrag(d);

      const onMove = (ev: PointerEvent) => {
        const cur = dragRef.current;
        if (!cur) return;
        const cp = toWorld(ev.clientX, ev.clientY);
        const hit = objectAt(snapshot, cp);
        const target = hit && hit.id !== (cur.from.kind === 'attached' ? cur.from.objectId : null) ? hit : null;
        const next = { ...cur, current: cp, target };
        dragRef.current = next;
        setDrag(next);
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };
      const onUp = (ev: PointerEvent) => {
        cleanup();
        const cur = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        if (!cur) return;
        const endP = toWorld(ev.clientX, ev.clientY);
        const hit = objectAt(snapshot, endP);
        let to: Endpoint;
        let toPoint: Point;
        if (hit && hit.id !== (cur.from.kind === 'attached' ? cur.from.objectId : null)) {
          toPoint = anchorFor(hit.rect, cur.fromPoint);
          to = { kind: 'attached', objectId: hit.id, fallback: toPoint };
        } else {
          to = { kind: 'free', x: endP.x, y: endP.y };
          toPoint = endP;
        }
        const id = createConnector(doc, cur.from, to, 'user');
        // null (same object / too short) leaves the tool active and creates nothing
        if (id) onCreated(id);
      };
      const onCancel = () => {
        cleanup();
        dragRef.current = null;
        setDrag(null);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [doc, onCreated, snapshot, startEndpointFor, toWorld],
  );

  const handleHoverMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragRef.current) return;
      const p = toWorld(e.clientX, e.clientY);
      const hit = objectAt(snapshot, p);
      setHover(hit);
    },
    [snapshot, toWorld],
  );

  const zoom = camera.zoom;
  const dotR = 6 / zoom;

  function dotsFor(rect: Rect, toward: Point, active: boolean): React.ReactElement[] {
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    const near = nearestSide(rect, toward);
    return sides.map((s) => {
      const a = sideAnchor(rect, s);
      const isActive = active && s === near;
      return (
        <circle
          key={`${rect.x}-${rect.y}-${s}`}
          data-testid="connector-dot"
          data-side={s}
          cx={a.x}
          cy={a.y}
          r={dotR}
          fill={isActive ? '#1976D2' : '#FFFFFF'}
          stroke="#1976D2"
          strokeWidth={2 / zoom}
        />
      );
    });
  }

  // Preview line endpoints in world space
  let preview: React.ReactElement | null = null;
  if (drag) {
    const fromPt = drag.fromPoint;
    const toPt = drag.target ? anchorFor(drag.target.rect, fromPt) : drag.current;
    preview = (
      <svg
        data-testid="connector-preview"
        style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
      >
        <line
          x1={(fromPt.x - camera.x) * zoom}
          y1={(fromPt.y - camera.y) * zoom}
          x2={(toPt.x - camera.x) * zoom}
          y2={(toPt.y - camera.y) * zoom}
          stroke="#1976D2"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      </svg>
    );
  }

  const hoverRect = drag?.target?.rect ?? hover?.rect ?? null;
  const towardPoint = drag ? drag.fromPoint : hover ? { x: 0, y: 0 } : { x: 0, y: 0 };

  return (
    <div
      ref={rootRef}
      data-testid="connector-tool-overlay"
      onPointerDown={handlePointerDown}
      onPointerMove={handleHoverMove}
      style={{ position: 'absolute', inset: 0, zIndex: 40, cursor: 'crosshair', touchAction: 'none' }}
    >
      {preview}
      {hoverRect && (
        <svg
          data-testid="connector-dots"
          style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
        >
          {dotsFor(hoverRect, towardPoint, !!drag)}
        </svg>
      )}
    </div>
  );
}
