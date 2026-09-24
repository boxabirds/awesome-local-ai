/**
 * Story 10 · task 13 — the Connector tool overlay (design "Connector tool and
 * connector object", PRD `connector.hover_points` / `connector.create_attached`
 * / `connector.create_free` / `connector.no_accidental`).
 *
 * Like the Shape tool this is a full-board pointer-capturing layer above the
 * world layer, so an arrow can start on top of an object without ever picking
 * that object up. Two extra things happen here:
 *
 *  - **hover**: whatever object is under the pointer shows four dots at its side
 *    midpoints (the places an arrow can land);
 *  - **drag**: the target under the pointer keeps its nearest dot highlighted,
 *    and the release either creates an arrow (attached to that object, or a free
 *    end over empty space) or is refused — the same object at both ends, or a
 *    span shorter than `CONNECTOR_MIN_LENGTH_WORLD` — in which case the tool
 *    stays a Connector and nothing is written.
 *
 * Which object is "under the pointer" is answered from the model snapshot with
 * the registry hit test (the DOM has this overlay in the way), so the answer is
 * the same one a later click on the finished arrow would give.
 */
import { useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { CONNECTOR_DOT_RADIUS_PX, DRAG_THRESHOLD_PX } from '../../shared/config';
import { createConnector } from '../../shared/objects/connector';
import type { Endpoint } from '../../shared/objects/connector';
import {
  nearestSide,
  sideAnchor,
  type Side,
} from '../../shared/geometry/connector-geometry';
import { hitTestAt } from '../objects/registry';
import { screenToWorld, worldToScreen, type Camera, type Point, type Size } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { UndoController } from '../board/undo';

export interface ConnectorToolProps {
  camera: Camera;
  /** The live board, read for hover and for the release hit test. */
  getSnapshot: () => readonly ObjectSnapshot[];
  /** The size of the board area, so the preview line can span it. */
  size: Size;
  doc: Y.Doc;
  /** This client's identity, recorded as `createdBy`. */
  by: string;
  /** The personal undo history: one arrow is one step. */
  undo?: UndoController;
  /** Called with the new id when an arrow was created. */
  onCreated(id: string): void;
}

/** One in-progress arrow, in screen pixels. */
interface DragState {
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** The object the drag started on, or null for a free start point. */
  startId: string | null;
  /** The object currently under the pointer, or null. */
  targetId: string | null;
}

/** The four sides, in the order the dots are drawn. */
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** The dots' radius, in screen pixels (constant at any zoom). */
const DOT = CONNECTOR_DOT_RADIUS_PX;

/** Objects an arrow may start from or land on: anything with a side to touch. */
function isAnchor(obj: ObjectSnapshot | null): boolean {
  return obj !== null && obj.type !== 'connector';
}

export function ConnectorTool(props: ConnectorToolProps): JSX.Element {
  const { camera, doc, by, getSnapshot, size, onCreated } = props;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const local = (event: ReactPointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  /** What could be connected under a screen point (null for empty space). */
  const anchorAt = (screenPoint: Point): ObjectSnapshot | null => {
    const world = screenToWorld(camera, screenPoint);
    const hit = hitTestAt(getSnapshot(), world, camera.zoom);
    return isAnchor(hit) ? hit : null;
  };

  const byId = (id: string | null): ObjectSnapshot | undefined =>
    id === null ? undefined : getSnapshot().find((obj) => obj.id === id);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom: capture is skipped; the handlers still fire in order.
    }
    const p = local(event);
    const start = anchorAt(p);
    setDrag({
      startX: p.x,
      startY: p.y,
      x: p.x,
      y: p.y,
      startId: start?.id ?? null,
      targetId: null,
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const p = local(event);
    if (drag === null) {
      const under = anchorAt(p);
      const next = under?.id ?? null;
      if (next !== hoverId) setHoverId(next);
      return;
    }
    const under = anchorAt(p);
    // A drag that ends where it started is refused, so the target is only ever
    // something *else*; that also keeps the highlight honest.
    const targetId = under && under.id !== drag.startId ? under.id : null;
    setDrag({ ...drag, x: p.x, y: p.y, targetId });
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag;
    setDrag(null);
    if (d === null || cancelled) return;
    event.stopPropagation();

    const travelled = Math.hypot(d.x - d.startX, d.y - d.startY);
    // A click (no drag) never draws an arrow.
    if (travelled < DRAG_THRESHOLD_PX) return;

    const fromWorld = screenToWorld(camera, { x: d.startX, y: d.startY });
    const toWorld = screenToWorld(camera, { x: d.x, y: d.y });

    const startObj = byId(d.startId);
    const targetObj = byId(d.targetId);
    // A drag that ends on the object it started on is refused outright (PRD
    // `connector.no_accidental`): an arrow from a shape to itself is never what
    // the person meant, and drawing one to a point *inside* that same shape is
    // the same mistake wearing a different hat.
    if (startObj !== undefined && d.targetId === null) {
      const underRelease = anchorAt({ x: d.x, y: d.y });
      if (underRelease !== null && underRelease.id === startObj.id) return;
    }

    const from: Endpoint = startObj
      ? {
          kind: 'attached',
          objectId: startObj.id,
          fallback: sideAnchor(rectOf(startObj), nearestSide(rectOf(startObj), toWorld)),
        }
      : { kind: 'free', x: fromWorld.x, y: fromWorld.y };
    const to: Endpoint = targetObj
      ? {
          kind: 'attached',
          objectId: targetObj.id,
          fallback: sideAnchor(rectOf(targetObj), nearestSide(rectOf(targetObj), fromWorld)),
        }
      : { kind: 'free', x: toWorld.x, y: toWorld.y };

    const create = () => createConnector(doc, from, to, by);
    const id = props.undo ? props.undo.step(create) : create();
    // Refused (same object, too short, stale target): the tool stays a Connector
    // and the next gesture starts fresh.
    if (id !== null) onCreated(id);
  };

  // --- what is drawn -------------------------------------------------------
  const dotsFor = (id: string | null, highlighted: Side | null) => {
    const obj = byId(id);
    if (!obj) return null;
    const rect = rectOf(obj);
    return SIDES.map((side) => {
      const anchor = worldToScreen(camera, sideAnchor(rect, side));
      return (
        <div
          key={`${id}-${side}`}
          data-testid="connector-dot"
          data-side={side}
          data-highlighted={highlighted === side ? 'true' : 'false'}
          style={{
            position: 'absolute',
            left: `${anchor.x - DOT}px`,
            top: `${anchor.y - DOT}px`,
            width: `${DOT * 2}px`,
            height: `${DOT * 2}px`,
            borderRadius: '50%',
            background: highlighted === side ? '#e0457b' : '#2f6fed',
            opacity: highlighted === side ? 1 : 0.55,
            pointerEvents: 'none',
          }}
        />
      );
    });
  };

  // While dragging, the dots belong to the target (with its near side lit);
  // otherwise they mark whatever the pointer is merely hovering.
  const dragTarget = drag?.targetId ?? null;
  const hoverTarget = drag === null ? hoverId : null;
  const dragTargetObj = byId(dragTarget);
  const highlighted =
    drag !== null && dragTargetObj !== undefined
      ? nearestSide(
          rectOf(dragTargetObj),
          screenToWorld(camera, { x: drag.x, y: drag.y }),
        )
      : null;
  const dots = [...(dotsFor(hoverTarget, null) ?? []), ...(dotsFor(dragTarget, highlighted) ?? [])];

  const previewLine =
    drag !== null && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= DRAG_THRESHOLD_PX ? (
      <svg
        data-testid="connector-preview"
        aria-hidden="true"
        width={size.width}
        height={size.height}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        <line
          x1={drag.startX}
          y1={drag.startY}
          x2={drag.x}
          y2={drag.y}
          stroke="#e0457b"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      </svg>
    ) : null;

  return (
    <div
      className="tool-overlay"
      data-testid="connector-tool"
      data-tool="connector"
      data-phase={drag === null ? 'hovering' : 'dragging'}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'auto',
        touchAction: 'none',
        cursor: 'crosshair',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={() => setDrag(null)}
    >
      {dots}
      {previewLine}
    </div>
  );
}

/** The rect a snapshot exposes for an anchor object. */
function rectOf(obj: ObjectSnapshot) {
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
}
