// The Connector tool (story 10, connector.create_drag, connector.snap_points).
//
// Like the Shape tool it is the board's whole surface while it is active: a
// press that lands on an object begins an arrow from that object instead of
// moving it, and a press on empty board begins a free end.
//
// It owns the three visible halves of the requirement and nothing else: the four
// snap points of whatever the pointer is over, the line that follows the pointer
// while it drags, and the target highlight. What the gesture MEANS - attached
// end or free end, too short, an arrow to itself, which side of a moved shape an
// end now leaves - is decided by the connector model and the shared geometry,
// which the board and this tool both read, so the two can never disagree.
import { useMemo, useRef, useState } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import { createConnector } from '../../shared/objects/connector.ts';
import type { Endpoint, Side } from '../../shared/geometry/connector-geometry.ts';
import { SIDES, nearestSide, referencePoint, sideAnchor } from '../../shared/geometry/connector-geometry.ts';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model.ts';
import type { Rect } from '../../shared/geometry.ts';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera.ts';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config.ts';
import { localIdentityId } from '../board/localIdentity.ts';
import { useUndoController } from '../board/useUndo.ts';
import { getObjectType } from '../objects/registry.tsx';

export interface ConnectorToolProps {
  /** the live camera */
  camera: Camera;
  /** the board as it is right now: the only thing that may be connected */
  snapshot: readonly ObjectSnapshot[];
  /** the board to write to */
  doc: Y.Doc;
  /** a connector was created: select it and hand the tool back to Select */
  onCreated(id: string): void;
}

interface DragState {
  startId: string | null;
  /** where the press landed, in world units */
  start: { x: number; y: number };
  /** the pointer's current world position */
  current: { x: number; y: number };
  /** the object the pointer is over, when it is a legal target */
  targetId: string | null;
  moved: boolean;
  startScreen: { x: number; y: number };
}

export function ConnectorTool(props: ConnectorToolProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const latest = useRef(props);
  latest.current = props;
  const dragRef = useRef<DragState | null>(null);
  const undo = useUndoController();

  // Every object with a box is a possible end: a shape and a note certainly, and
  // a text or even another connector too. The box is the one the board model
  // derived, so a connector's own box is already resolved.
  const rects = useMemo(() => {
    const map = new Map<string, Rect>();
    for (const obj of props.snapshot) {
      const box = objectBounds(obj);
      if (box !== null) map.set(obj.id, box);
    }
    return map;
  }, [props.snapshot]);

  const screenPoint = (e: { clientX: number; clientY: number }) => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  // Topmost object under a world point, through the same registry the marquee
  // and the selection use - so a connector, whose box is mostly empty space, is
  // only hit by its own near-the-line rule.
  const hit = (world: { x: number; y: number }, zoom: number): ObjectSnapshot | null => {
    const ctx = { zoom, rects };
    for (let i = props.snapshot.length - 1; i >= 0; i--) {
      const obj = props.snapshot[i];
      const spec = getObjectType(obj.type);
      if (spec?.hitTest) {
        if (spec.hitTest(obj, world, ctx)) return obj;
        continue;
      }
      const box = rects.get(obj.id);
      if (box && world.x >= box.x && world.x <= box.x + box.width && world.y >= box.y && world.y <= box.y + box.height) {
        return obj;
      }
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || dragRef.current) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom / unsupported */
    }
    const cam = latest.current.camera;
    const world = screenToWorld(cam, screenPoint(e));
    const start = hit(world, cam.zoom);
    const next: DragState = {
      startId: start?.id ?? null,
      start: world,
      current: world,
      targetId: null,
      moved: false,
      startScreen: screenPoint(e),
    };
    dragRef.current = next;
    setDrag(next);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const cam = latest.current.camera;
    const point = screenPoint(e);
    const world = screenToWorld(cam, point);
    const d = dragRef.current;
    if (!d) {
      // Nothing is being dragged: this is the hover, whose only job is to show
      // the four snap points (connector.snap_points).
      const over = hit(world, cam.zoom);
      setHoverId((previous) => (previous === (over?.id ?? null) ? previous : over?.id ?? null));
      return;
    }
    const over = hit(world, cam.zoom);
    const next: DragState = {
      ...d,
      current: world,
      // An arrow back onto the object it started from is not a target; the tool
      // simply never offers it, and the release falls back to a free end.
      targetId: over && over.id !== d.startId ? over.id : null,
      moved: d.moved || Math.hypot(point.x - d.startScreen.x, point.y - d.startScreen.y) >= 3,
    };
    dragRef.current = next;
    setDrag(next);
    setHoverId(null);
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, commit: boolean): void => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* jsdom / unsupported */
    }
    if (!d || !commit) return;

    const cam = latest.current.camera;
    const world = screenToWorld(cam, screenPoint(e));
    const over = hit(world, cam.zoom);

    // An arrow back onto the object it started from is not an arrow: the tool
    // never offers that target, and releasing there - however far the pointer
    // travelled, however short - creates nothing at all rather than an arrow with
    // one end pinned inside the shape it already points at.
    if (d.startId !== null && over !== null && over.id === d.startId) return;

    const targetId = over && over.id !== d.startId ? over.id : null;

    const from: Endpoint = d.startId
      ? { kind: 'attached', objectId: d.startId, fallback: d.start }
      : { kind: 'free', x: d.start.x, y: d.start.y };
    const to: Endpoint = targetId
      ? { kind: 'attached', objectId: targetId, fallback: { x: world.x, y: world.y } }
      : { kind: 'free', x: world.x, y: world.y };

    // One step for "a connector was created"; a rejected gesture (too short, an
    // arrow to itself) writes nothing and the tool stays where it is.
    undo?.boundary();
    const id = createConnector(latest.current.doc, from, to, localIdentityId());
    undo?.boundary();
    if (id !== null) latest.current.onCreated(id);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => finish(e, true);
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => finish(e, false);

  const cam = props.camera;
  // The snap points are shown on what the pointer is over (hover), and on what
  // a drag is currently over (target) - never on both ends at once, so the
  // source's points do not clutter the place you are trying to drop.
  const dotId = drag ? drag.targetId : hoverId;
  const dotRect = dotId ? rects.get(dotId) : undefined;
  const highlightSide: Side | null =
    drag && drag.targetId && dotRect
      ? nearestSide(
          dotRect,
          referencePoint(
            drag.startId
              ? { kind: 'attached', objectId: drag.startId, fallback: drag.start }
              : { kind: 'free', x: drag.start.x, y: drag.start.y },
            rects,
          ),
        )
      : null;

  // The line follows the pointer. When the drag started on an object it starts
  // at the anchor the arrow would really have, so what you see is what lands.
  const lineStart: { x: number; y: number } = useMemo(() => {
    if (!drag) return { x: 0, y: 0 };
    const rect = drag.startId ? rects.get(drag.startId) : undefined;
    if (!rect) return drag.start;
    return sideAnchor(rect, nearestSide(rect, drag.current));
  }, [drag, rects]);

  const a = worldToScreen(cam, lineStart);
  const b = worldToScreen(cam, drag ? drag.current : { x: lineStart.x, y: lineStart.y });

  return (
    <div
      ref={rootRef}
      data-testid="connector-tool"
      role="presentation"
      aria-label="Connector tool: drag from one object to another"
      style={{ position: 'fixed', inset: 0, zIndex: 0, cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {dotRect && dotId
        ? SIDES.map((side) => {
            const anchor = worldToScreen(cam, sideAnchor(dotRect, side));
            const on = side === highlightSide;
            return (
              <div
                key={side}
                data-testid="connector-dot"
                data-side={side}
                data-object-id={dotId}
                data-highlighted={on}
                style={{
                  position: 'fixed',
                  left: `${anchor.x - CONNECTOR_DOT_RADIUS_PX}px`,
                  top: `${anchor.y - CONNECTOR_DOT_RADIUS_PX}px`,
                  width: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
                  height: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
                  borderRadius: '50%',
                  border: '1px solid #2563eb',
                  background: on ? '#2563eb' : '#ffffff',
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                }}
              />
            );
          })
        : null}
      {drag ? (
        <svg
          data-testid="connector-preview"
          width={1}
          height={1}
          style={{ position: 'fixed', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
          aria-hidden="true"
        >
          <line
            data-testid="connector-preview-line"
            data-target={drag.targetId ?? ''}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#2563eb"
            strokeWidth={2}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
    </div>
  );
}
