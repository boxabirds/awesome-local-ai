// The Connector tool (story 10, conn.create / conn.highlight /
// conn.create_free): a screen-space overlay above the board world while the
// tool is active. Hovering an object shows four dots at its side midpoints;
// a drag from an object (or from empty board) draws a live line to the
// pointer; releasing on an object attaches both ends (one end may start
// free), releasing on empty board leaves that end free at the drop point.
// The target's NEAREST-side dot highlights while dragging over it.
//
// The overlay captures ALL pointer events while the tool is active
// (tool isolation).

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import * as Y from 'yjs';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import { type Point } from '../../shared/geometry';
import { nearestSide, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { objectAtPoint as objectAtPointIn } from '../objects/hitTest';

export interface ConnectorToolProps {
  /** The shared camera (screen ↔ world). */
  camera: Camera;
  /** The board snapshot (all objects, ascending z). */
  snapshot: readonly ObjectSnapshot[];
  /** The board doc (the created connector is written here). */
  doc: Y.Doc;
  /** The creator identity (createdBy). */
  createdBy: string;
  /** Undo boundary marker (one creation = one undo step). */
  onBoundary(): void;
  /** A connector was created: select it and switch back to Select. */
  onCreated(id: string): void;
}

interface DragState {
  /** The object the drag started on (attached start), if any. */
  startAttachedId: string | null;
  startWorld: Point;
  current: Point;
  /** The object currently under the pointer (≠ start), if any. */
  targetId: string | null;
}

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

export function ConnectorTool(props: ConnectorToolProps): ReactElement {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const objectAt = (world: Point): ObjectSnapshot | undefined => {
    return objectAtPointIn(props.doc, props.snapshot, world, props.camera.zoom);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const world = screenToWorld(props.camera, toLocal(e));
    const hit = objectAt(world);
    setDrag({ startAttachedId: hit?.id ?? null, startWorld: world, current: world, targetId: null });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    const world = screenToWorld(props.camera, toLocal(e));
    if (d === null) {
      const hit = objectAt(world);
      setHoverId(hit?.id ?? null);
      return;
    }
    const hit = objectAt(world);
    setDrag({
      ...d,
      current: world,
      targetId: hit !== undefined && hit.id !== d.startAttachedId ? hit.id : null,
    });
  };

  const releaseCapture = (e: ReactPointerEvent<HTMLDivElement>): void => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Already released (pointercancel); harmless.
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (d === null) return;
    releaseCapture(e);
    setDrag(null);
    const world = screenToWorld(props.camera, toLocal(e));
    const hit = objectAt(world);

    // The start end.
    const from: Endpoint =
      d.startAttachedId !== null
        ? { kind: 'attached', objectId: d.startAttachedId, fallback: world }
        : { kind: 'free', x: d.startWorld.x, y: d.startWorld.y };

    // The target end: an object under the pointer → attached to it (the
    // model fixes the fallback anchor); empty board → free at the drop.
    let to: Endpoint;
    if (hit !== undefined && hit.id !== d.startAttachedId) {
      const r = objectBounds(hit);
      to = { kind: 'attached', objectId: hit.id, fallback: sideAnchor(r, nearestSide(r, d.startWorld)) };
    } else {
      to = { kind: 'free', x: world.x, y: world.y };
    }

    // One creation is one undo step (boundary before and after).
    props.onBoundary();
    const id = createConnector(props.doc, from, to, props.createdBy);
    if (id !== null) props.onCreated(id);
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>): void => {
    releaseCapture(e);
    setDrag(null);
    setHoverId(null);
  };

  // What to show dots for: the hovered object (no drag), the drag's target
  // object while over it (the nearest side highlights), else the drag's
  // start object (while dragging over empty board).
  const dotObjectId: string | null =
    drag !== null ? (drag.targetId ?? drag.startAttachedId) : hoverId;
  const dotObj = dotObjectId === null ? undefined : props.snapshot.find((o) => o.id === dotObjectId);

  // The highlight: the target's nearest side (towards the drag start).
  let highlight: { id: string; side: Side; anchor: Point } | null = null;
  if (drag !== null && drag.targetId !== null) {
    const target = props.snapshot.find((o) => o.id === drag.targetId);
    if (target !== undefined) {
      const r = objectBounds(target);
      const side = nearestSide(r, drag.startWorld);
      highlight = { id: target.id, side, anchor: sideAnchor(r, side) };
    }
  }

  // The live drag line (screen space): from the start point (the attached
  // start's NEAREST-side anchor towards the pointer, so the line grows from
  // the object) to the pointer — or to the highlighted anchor over a target.
  let dragLine: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (drag !== null) {
    let startScreen: Point;
    if (drag.startAttachedId !== null) {
      const startObj = props.snapshot.find((o) => o.id === drag.startAttachedId);
      if (startObj !== undefined) {
        const r = objectBounds(startObj);
        startScreen = worldToScreen(props.camera, sideAnchor(r, nearestSide(r, drag.current)));
      } else {
        startScreen = worldToScreen(props.camera, drag.startWorld);
      }
    } else {
      startScreen = worldToScreen(props.camera, drag.startWorld);
    }
    const endScreen = highlight !== null ? worldToScreen(props.camera, highlight.anchor) : worldToScreen(props.camera, drag.current);
    dragLine = { x1: startScreen.x, y1: startScreen.y, x2: endScreen.x, y2: endScreen.y };
  }

  return (
    <div
      ref={overlayRef}
      className="connector-tool"
      data-testid="connector-tool"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <svg className="connector-tool-svg" width="100%" height="100%" aria-hidden="true">
        {dragLine !== null && (
          <line
            x1={dragLine.x1}
            y1={dragLine.y1}
            x2={dragLine.x2}
            y2={dragLine.y2}
            stroke="#1E88E5"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )}
        {dotObj !== undefined &&
          SIDES.map((side) => {
            const r = objectBounds(dotObj);
            const a = sideAnchor(r, side);
            const s = worldToScreen(props.camera, a);
            const hl = highlight !== null && dotObj.id === highlight.id && highlight.side === side;
            return (
              <circle
                key={side}
                data-testid="connector-dot"
                data-side={side}
                data-highlighted={hl ? 'true' : undefined}
                cx={s.x}
                cy={s.y}
                r={CONNECTOR_DOT_RADIUS_PX}
                className={hl ? 'connector-dot connector-dot--highlighted' : 'connector-dot'}
              />
            );
          })}
      </svg>
    </div>
  );
}
