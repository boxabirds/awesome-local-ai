import { useContext, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD, SHAPE_STROKE_COLORS } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { nearestSide, rectCentre, sideAnchor, SIDES, type Side } from '../../shared/geometry/connector-geometry';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { asStep, UndoContext } from '../board/useUndo';
import { attachTargetAt, rectOf } from './connectorTargets';

interface Drawing {
  pointerId: number;
  /** World point pressed. */
  start: Point;
  /** Object the arrow starts on, or null for a free start. */
  fromId: string | null;
  /** World point under the pointer now. */
  current: Point;
}

/**
 * The Connector tool's input surface over the whole board. Hovering an object shows connection dots at its four
 * side midpoints (connector.hover_points). A drag from an object (or empty space) draws a preview arrow; over
 * another object that object's dots show with the one the arrow will attach to highlighted. The release creates
 * the arrow in one undo step (connector.create_attached, connector.create_free) and hands its id to `onCreated`;
 * a release on the starting object or after moving less than CONNECTOR_MIN_LENGTH_WORLD creates nothing and the
 * tool stays (connector.no_accidental), as does pointercancel.
 */
export function ConnectorTool(props: {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  onCreated(id: string): void;
  doc: Y.Doc;
  /** Author recorded on the new arrow. */
  by: string;
}) {
  const { camera, snapshot } = props;
  const ref = useRef<HTMLDivElement>(null);
  const undo = useContext(UndoContext);
  const [hover, setHover] = useState<Point | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const drawingRef = useRef<Drawing | null>(null);

  const world = (e: { clientX: number; clientY: number }): Point => {
    const r = ref.current?.getBoundingClientRect();
    return screenToWorld(camera, { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
  };
  const update = (d: Drawing | null) => {
    drawingRef.current = d;
    setDrawing(d);
  };
  const byId = (id: string | null) => (id === null ? null : (snapshot.find((o) => o.id === id) ?? null));

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || drawingRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic pointer: moves still arrive while over the surface.
    }
    const p = world(e);
    const from = attachTargetAt(snapshot, p, camera.zoom);
    update({ pointerId: e.pointerId, start: p, fromId: from?.id ?? null, current: p });
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const p = world(e);
    setHover(p);
    const d = drawingRef.current;
    if (d && e.pointerId === d.pointerId) update({ ...d, current: p });
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drawingRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    update(null);
    const p = world(e);
    setHover(p);
    if (Math.hypot(p.x - d.start.x, p.y - d.start.y) < CONNECTOR_MIN_LENGTH_WORLD) return;
    const target = attachTargetAt(snapshot, p, camera.zoom);
    if (target && target.id === d.fromId) return;
    const fromObj = byId(d.fromId);
    const fromRef = fromObj ? rectCentre(rectOf(fromObj)) : d.start;
    const toRef = target ? rectCentre(rectOf(target)) : p;
    const end = (o: ObjectSnapshot | null, point: Point, other: Point): Endpoint =>
      o
        ? { kind: 'attached', objectId: o.id, fallback: sideAnchor(rectOf(o), nearestSide(rectOf(o), other)) }
        : { kind: 'free', x: point.x, y: point.y };
    const id = asStep(undo, () =>
      createConnector(props.doc, end(fromObj, d.start, toRef), end(target, p, fromRef), props.by),
    );
    if (id) props.onCreated(id);
  };
  const cancel = (e: ReactPointerEvent) => {
    if (drawingRef.current?.pointerId === e.pointerId) update(null);
  };

  // What to draw: the dots of the object under the pointer (the target while drawing) and the preview arrow.
  const pointer = drawing?.current ?? hover;
  const fromObj = drawing ? byId(drawing.fromId) : null;
  const under = pointer ? attachTargetAt(snapshot, pointer, camera.zoom) : null;
  const dotsObj = drawing && under?.id === drawing.fromId ? null : under;
  let highlighted: Side | null = null;
  let preview: { from: Point; to: Point } | null = null;
  if (drawing) {
    const fromRef = fromObj ? rectCentre(rectOf(fromObj)) : drawing.start;
    const toPoint = dotsObj ? sideAnchor(rectOf(dotsObj), nearestSide(rectOf(dotsObj), fromRef)) : drawing.current;
    if (dotsObj) highlighted = nearestSide(rectOf(dotsObj), fromRef);
    const toRef = dotsObj ? rectCentre(rectOf(dotsObj)) : drawing.current;
    const fromPoint = fromObj ? sideAnchor(rectOf(fromObj), nearestSide(rectOf(fromObj), toRef)) : drawing.start;
    preview = { from: worldToScreen(camera, fromPoint), to: worldToScreen(camera, toPoint) };
  }

  return (
    <div
      ref={ref}
      className="tool-surface tool-surface--connector"
      data-testid="connector-tool"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancel}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg className="connector-tool__layer" aria-hidden="true">
        {preview && (
          <line
            className="connector-preview"
            data-testid="connector-preview"
            x1={preview.from.x}
            y1={preview.from.y}
            x2={preview.to.x}
            y2={preview.to.y}
            stroke={SHAPE_STROKE_COLORS.blue}
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )}
        {dotsObj &&
          SIDES.map((side) => {
            const at = worldToScreen(camera, sideAnchor(rectOf(dotsObj), side));
            const on = side === highlighted;
            return (
              <circle
                key={side}
                className={`connection-dot${on ? ' connection-dot--highlighted' : ''}`}
                data-testid="connection-dot"
                data-side={side}
                data-object-id={dotsObj.id}
                data-highlighted={on}
                cx={at.x}
                cy={at.y}
                r={on ? CONNECTOR_DOT_RADIUS_PX + 1 : CONNECTOR_DOT_RADIUS_PX}
              />
            );
          })}
      </svg>
    </div>
  );
}
