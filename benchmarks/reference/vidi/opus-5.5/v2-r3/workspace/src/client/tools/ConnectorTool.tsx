import { useRef, useState, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { nearestSide, rectCentre, SIDES, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import { useUndoController } from '../board/useUndo';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { attachableAt } from '../objects/registry';
import { localAuthor } from '../objects/TextObject';

interface Drawing {
  pointerId: number;
  /** World point pressed. */
  start: Point;
  /** Object pressed (the arrow starts attached to it), or null for empty space. */
  startId: string | null;
  current: Point;
}

/**
 * Connector tool layer (story 10, connector.ui). Hovering an object shows its
 * four side dots; dragging from an object (or empty space) to another object
 * (or empty space) creates an arrow, highlighting the dot it will attach to.
 * Releasing on the start object, or after moving less than
 * CONNECTOR_MIN_LENGTH_WORLD, creates nothing and the tool stays active.
 */
export function ConnectorTool(props: {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  onCreated(id: string): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const drawingRef = useRef<Drawing | null>(null);
  const undo = useUndoController();
  const { camera, snapshot } = props;

  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const r = ref.current!.getBoundingClientRect();
    return screenToWorld(camera, { x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const objectAt = (p: Point) => attachableAt(snapshot, p, camera.zoom);
  const update = (d: Drawing | null) => {
    drawingRef.current = d;
    setDrawing(d);
  };

  /** Where the start end points from: the pressed object's centre (current rect), or the pressed point. */
  const startReference = (d: Drawing): Point => {
    const obj = d.startId ? snapshot.find((o) => o.id === d.startId) : undefined;
    return obj ? rectCentre(objectBounds(obj)) : d.start;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || drawingRef.current) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Unavailable for synthetic events; events still reach the layer.
    }
    const p = toWorld(e);
    update({ pointerId: e.pointerId, start: p, startId: objectAt(p)?.id ?? null, current: p });
    setHover(p);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = toWorld(e);
    setHover(p);
    const d = drawingRef.current;
    if (d && d.pointerId === e.pointerId) update({ ...d, current: p });
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drawingRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const end = toWorld(e);
    update(null);
    // connector.no_accidental: too short a drag creates nothing.
    if (Math.hypot(end.x - d.start.x, end.y - d.start.y) < CONNECTOR_MIN_LENGTH_WORLD) return;
    const target = objectAt(end);
    if (target && target.id === d.startId) return; // released on its own start object
    const startObj = d.startId ? snapshot.find((o) => o.id === d.startId) : undefined;
    const startRef = startReference(d);
    const toRef = target ? rectCentre(objectBounds(target)) : end;
    const from: Endpoint = startObj
      ? { kind: 'attached', objectId: startObj.id, fallback: sideAnchor(objectBounds(startObj), nearestSide(objectBounds(startObj), toRef)) }
      : { kind: 'free', x: d.start.x, y: d.start.y };
    const to: Endpoint = target
      ? { kind: 'attached', objectId: target.id, fallback: sideAnchor(objectBounds(target), nearestSide(objectBounds(target), startRef)) }
      : { kind: 'free', x: end.x, y: end.y };
    undo.boundary();
    const id = createConnector(props.doc, from, to, localAuthor(props.doc));
    undo.boundary();
    if (id) props.onCreated(id);
  };

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (drawingRef.current?.pointerId === e.pointerId) update(null);
  };

  // What to show: the object under the pointer (its dots), highlighted while dragging to it.
  const pointer = drawing?.current ?? hover;
  const under = pointer ? objectAt(pointer) : null;
  let highlight: Side | null = null;
  if (drawing && under && under.id !== drawing.startId) {
    highlight = nearestSide(objectBounds(under), startReference(drawing));
  }
  const dotsRect: Rect | null = under ? objectBounds(under) : null;

  let preview: { a: Point; b: Point } | null = null;
  if (drawing) {
    const startObj = drawing.startId ? snapshot.find((o) => o.id === drawing.startId) : undefined;
    const endPoint = under && highlight ? sideAnchor(objectBounds(under), highlight) : drawing.current;
    const a = startObj ? sideAnchor(objectBounds(startObj), nearestSide(objectBounds(startObj), endPoint)) : drawing.start;
    preview = { a: worldToScreen(camera, a), b: worldToScreen(camera, endPoint) };
  }

  return (
    <div
      ref={ref}
      className="tool-layer connector-tool"
      data-testid="connector-tool"
      data-state={drawing ? 'dragging' : 'hovering'}
      data-hover-id={under?.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onPointerLeave={() => {
        if (!drawingRef.current) setHover(null);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg className="connector-tool-svg" aria-hidden="true" focusable="false">
        {preview && (
          <line
            className="connector-preview"
            data-testid="connector-preview"
            x1={preview.a.x}
            y1={preview.a.y}
            x2={preview.b.x}
            y2={preview.b.y}
          />
        )}
        {dotsRect &&
          SIDES.map((side) => {
            const p = worldToScreen(camera, sideAnchor(dotsRect, side));
            const on = side === highlight;
            return (
              <circle
                key={side}
                className={`connection-dot${on ? ' is-highlighted' : ''}`}
                data-testid="connection-dot"
                data-side={side}
                data-highlighted={on ? 'true' : 'false'}
                data-object-id={under!.id}
                cx={p.x}
                cy={p.y}
                r={on ? CONNECTOR_DOT_RADIUS_PX * 1.5 : CONNECTOR_DOT_RADIUS_PX}
              />
            );
          })}
      </svg>
    </div>
  );
}
