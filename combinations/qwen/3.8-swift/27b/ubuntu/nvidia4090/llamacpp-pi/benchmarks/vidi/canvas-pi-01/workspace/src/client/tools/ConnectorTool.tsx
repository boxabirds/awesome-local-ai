// Connector drawing tool (see spec: connector.ui, connector.hover_points,
// connector.create_attached, connector.create_free, connector.no_accidental).
//
// A full-viewport overlay active while tool === 'connector':
// - Hovering an object shows four CONNECTOR_DOT_RADIUS_PX dots at its side
//   midpoints (connector.hover_points).
// - Dragging from an object (attached start) or empty space (free start)
//   draws a dashed screen-space preview; over another object the target's
//   nearest-side dot is highlighted (connector.hover_points).
// - Release over another object → attached end, over empty space → free end;
//   `createConnector` is called once on pointerup. Rejected creations (same
//   object, too short) create nothing and the tool stays active;
//   pointercancel creates nothing. Success → stopCapturing + onCreated
//   (select + return to Select).

import { useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import {
  CONNECTOR_DOT_RADIUS_PX,
} from '../../shared/config';
import {
  nearestSide,
  sideAnchor,
  type Endpoint,
  type Side,
} from '../../shared/geometry/connector-geometry';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { pointInRect, type Point, type Rect } from '../../shared/geometry';
import { createConnector } from '../../shared/objects/connector';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import type { UndoController } from '../board/undo';

export interface ConnectorToolProps {
  /** Current camera (screen ↔ world conversion). */
  camera: Camera;
  /** Every object's snapshot (hover hit-testing). */
  snapshot: readonly ObjectSnapshot[];
  /** The live Y.Doc. */
  doc: Y.Doc;
  /** This tab's undo controller (stopCapturing after creation). */
  undo?: UndoController | null;
  /** The creator identity (per-tab Yjs client id). */
  by: string;
  /** A connector was created: select it and return to Select (BoardPage). */
  onCreated(id: string): void;
}

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** The frontmost non-connector object whose bounds contain `world` (or null). */
function objectUnder(snapshot: readonly ObjectSnapshot[], world: Point): ObjectSnapshot | null {
  let best: ObjectSnapshot | null = null;
  let bestZ = -Infinity;
  for (const n of snapshot) {
    if (n.type === 'connector') continue;
    if (!pointInRect(objectBounds(n), world)) continue;
    if (n.z > bestZ) {
      best = n;
      bestZ = n.z;
    }
  }
  return best;
}

/** The rect of `note` in world units (stickies fall back to the note size). */
function noteRect(note: ObjectSnapshot): Rect {
  return objectBounds(note);
}

export function ConnectorTool({
  camera,
  snapshot,
  doc,
  undo,
  by,
  onCreated,
}: ConnectorToolProps): JSX.Element {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ start: Endpoint } | null>(null);
  const [hover, setHover] = useState<{ rect: Rect; id: string } | null>(null);
  const [drag, setDrag] = useState<{ start: Endpoint; point: Point; targetId: string | null } | null>(null);

  const toWorld = (event: { clientX: number; clientY: number }): Point => {
    const el = overlayRef.current;
    if (el === null) return screenToWorld(camera, { x: event.clientX, y: event.clientY });
    const rect = el.getBoundingClientRect();
    return screenToWorld(camera, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const el = overlayRef.current;
    if (el === null) return;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture unsupported (e.g. jsdom) — drag still works.
    }
    const world = toWorld(event);
    const target = objectUnder(snapshot, world);
    const start: Endpoint =
      target === null
        ? { kind: 'free', x: world.x, y: world.y }
        : { kind: 'attached', objectId: target.id, fallback: world };
    dragRef.current = { start };
    setDrag({ start, point: world, targetId: target === null ? null : target.id });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const world = toWorld(event);
    if (dragRef.current === null) {
      // Hover dots (connector.hover_points).
      const target = objectUnder(snapshot, world);
      setHover(target === null ? null : { rect: noteRect(target), id: target.id });
      return;
    }
    const start = dragRef.current.start;
    const target = objectUnder(snapshot, world);
    setDrag({
      start,
      point: world,
      targetId:
        target !== null && (start.kind !== 'attached' || target.id !== start.objectId)
          ? target.id
          : null,
    });
    setHover(null);
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const dragState = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    setHover(null);
    if (dragState === null || cancelled) return;
    const world = toWorld(event);
    const target = objectUnder(snapshot, world);
    const end: Endpoint =
      target === null
        ? { kind: 'free', x: world.x, y: world.y }
        : { kind: 'attached', objectId: target.id, fallback: world };
    const id = createConnector(doc, dragState.start, end, by);
    if (id !== null) {
      undo?.boundary();
      onCreated(id);
    }
    // Rejected (same object / too short): nothing created, tool stays.
  };

  // Dots for a rect: the hovered object (idle) or the drag target.
  const dotRect =
    drag !== null && drag.targetId !== null
      ? (hoverForId(drag.targetId) ?? null)
      : hover;
  const highlightSide: Side | null =
    dotRect !== null && drag !== null && drag.targetId !== null
      ? nearestSide(dotRect.rect, drag.point)
      : null;

  let dots = null;
  if (dotRect !== null) {
    dots = SIDES.map((side) => {
      const anchor = worldToScreen(camera, sideAnchor(dotRect.rect, side));
      return (
        <span
          key={side}
          data-testid="connector-dot"
          data-side={side}
          data-highlighted={highlightSide === side || undefined}
          className="connector-dot"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: anchor.x - CONNECTOR_DOT_RADIUS_PX,
            top: anchor.y - CONNECTOR_DOT_RADIUS_PX,
            width: CONNECTOR_DOT_RADIUS_PX * 2,
            height: CONNECTOR_DOT_RADIUS_PX * 2,
          }}
        />
      );
    });
  }

  // Dashed preview line from the resolved start anchor to the pointer.
  let preview = null;
  if (drag !== null) {
    const startRect =
      drag.start.kind === 'attached'
        ? (hoverForId(drag.start.objectId) ?? null)
        : null;
    const from =
      startRect === null
        ? { x: (drag.start as { kind: 'free'; x: number; y: number }).x, y: (drag.start as { kind: 'free'; x: number; y: number }).y }
        : sideAnchor(startRect.rect, nearestSide(startRect.rect, drag.point));
    const a = worldToScreen(camera, from);
    const b = worldToScreen(camera, drag.point);
    preview = (
      <svg
        data-testid="connector-preview"
        className="connector-preview"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <line
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke="#334155"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      </svg>
    );
  }

  return (
    <div
      ref={overlayRef}
      data-testid="connector-tool"
      className="connector-tool"
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 5 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finishDrag(e, false)}
      onPointerCancel={(e) => finishDrag(e, true)}
    >
      {dots}
      {preview}
    </div>
  );

  function hoverForId(id: string): { rect: Rect; id: string } | null {
    const note = snapshot.find((n) => n.id === id && n.type !== 'connector');
    if (note === undefined) return null;
    return { rect: noteRect(note), id };
  }
}
