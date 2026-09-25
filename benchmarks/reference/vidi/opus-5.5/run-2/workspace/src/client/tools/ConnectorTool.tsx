/**
 * The Connector tool's input layer (anchors: connector.create_attached,
 * connector.create_free, connector.no_accidental, connector.hover_points,
 * tools.return_to_select).
 *
 * A screen-space layer over the whole board while the tool is active. Hovering an object
 * shows connection dots at its four side midpoints; dragging shows a preview arrow and
 * highlights the dot of the object under the pointer that the arrow will attach to.
 * Release over another object attaches the end, over empty space leaves it free at that
 * point; release on the start object or after less than CONNECTOR_MIN_LENGTH_WORLD creates
 * nothing and the tool stays active. A created arrow closes the undo step and is reported
 * so it is selected and Select becomes active. pointercancel creates nothing.
 */
import { useContext, useMemo, useRef, useState, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import { anchorToward, nearestSide, rectCentre, sideAnchor, SIDES, type Side } from '../../shared/geometry/connector-geometry';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { UndoContext } from '../board/useUndo';
import { connectableAt } from '../objects/registry';
import { layerPoint, PRIMARY_BUTTON } from './toolLayer';

export interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  onCreated(id: string): void;
  doc: Y.Doc;
  /** Identity stored as `createdBy`. */
  createdBy: string;
}

interface Press {
  pointerId: number;
  /** World point of the press. */
  start: Point;
  /** Object pressed on (null: empty space). */
  from: ObjectSnapshot | null;
}

function Dots(props: { rect: Rect; camera: Camera; highlighted: Side | null }): React.JSX.Element {
  return (
    <>
      {SIDES.map((s) => {
        const p = worldToScreen(props.camera, sideAnchor(props.rect, s));
        return (
          <circle
            key={s}
            className="connection-dot"
            data-testid="connection-dot"
            data-side={s}
            data-highlighted={s === props.highlighted ? 'true' : 'false'}
            data-x={p.x}
            data-y={p.y}
            cx={p.x}
            cy={p.y}
            r={CONNECTOR_DOT_RADIUS_PX}
          />
        );
      })}
    </>
  );
}

export function ConnectorTool(props: ConnectorToolProps): React.JSX.Element {
  const { camera, snapshot } = props;
  const history = useContext(UndoContext);
  const press = useRef<Press | null>(null);
  const [pressed, setPressed] = useState<Press | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const byId = useMemo(() => new Map(snapshot.map((o) => [o.id, o])), [snapshot]);

  const worldOf = (e: PointerEvent<HTMLDivElement>) => screenToWorld(camera, layerPoint(e));
  const objectAt = (p: Point) => connectableAt(snapshot, p, camera.zoom) ?? null;
  /** Current rect of an object (it may have been moved or deleted since the press). */
  const rectOf = (o: ObjectSnapshot | null): Rect | undefined => {
    if (o === null) return undefined;
    const now = byId.get(o.id);
    return now === undefined ? undefined : objectBounds(now);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== PRIMARY_BUTTON) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const start = worldOf(e);
    const p = { pointerId: e.pointerId, start, from: objectAt(start) };
    press.current = p;
    setPressed(p);
    setPointer(start);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p !== null && e.pointerId !== p.pointerId) return;
    setPointer(worldOf(e));
  };
  const end = () => {
    press.current = null;
    setPressed(null);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p === null || e.pointerId !== p.pointerId) return;
    e.stopPropagation();
    end();
    const at = worldOf(e);
    setPointer(at);
    const target = objectAt(at);
    // connector.no_accidental: released on the start object, or barely moved.
    if (Math.hypot(at.x - p.start.x, at.y - p.start.y) < CONNECTOR_MIN_LENGTH_WORLD) return;
    if (target !== null && p.from !== null && target.id === p.from.id) return;
    const fromRect = rectOf(p.from);
    const toRect = rectOf(target);
    const fromRef = fromRect === undefined ? p.start : rectCentre(fromRect);
    const toRef = toRect === undefined ? at : rectCentre(toRect);
    const from: Endpoint =
      p.from === null
        ? { kind: 'free', x: p.start.x, y: p.start.y }
        : { kind: 'attached', objectId: p.from.id, fallback: fromRect === undefined ? p.start : anchorToward(fromRect, toRef) };
    const to: Endpoint =
      target === null
        ? { kind: 'free', x: at.x, y: at.y }
        : { kind: 'attached', objectId: target.id, fallback: toRect === undefined ? at : anchorToward(toRect, fromRef) };
    history.boundary();
    const id = createConnector(props.doc, from, to, props.createdBy);
    history.boundary();
    if (id !== null) props.onCreated(id);
  };
  const onPointerLeave = () => {
    if (press.current === null) setPointer(null);
  };

  // Hover: dots on the object under the pointer. Dragging: dots on the target, the one
  // the arrow will attach to highlighted, and a preview arrow.
  const hovered = pointer === null ? null : objectAt(pointer);
  let dots: React.JSX.Element | null = null;
  let preview: { a: Point; b: Point } | null = null;
  if (pressed === null) {
    const r = rectOf(hovered);
    if (r !== undefined) dots = <Dots rect={r} camera={camera} highlighted={null} />;
  } else if (pointer !== null) {
    const fromRect = rectOf(pressed.from);
    const onStart = hovered !== null && pressed.from !== null && hovered.id === pressed.from.id;
    const toRect = onStart ? undefined : rectOf(hovered);
    const fromRef = fromRect === undefined ? pressed.start : rectCentre(fromRect);
    const toSide = toRect === undefined ? null : nearestSide(toRect, fromRef);
    const b = toRect === undefined || toSide === null ? pointer : sideAnchor(toRect, toSide);
    const a = fromRect === undefined ? pressed.start : anchorToward(fromRect, toRect === undefined ? pointer : rectCentre(toRect));
    preview = { a: worldToScreen(camera, a), b: worldToScreen(camera, b) };
    const shown = toRect ?? (onStart ? fromRect : undefined);
    if (shown !== undefined) dots = <Dots rect={shown} camera={camera} highlighted={toSide} />;
  }

  return (
    <div
      className="tool-layer connector-tool"
      data-testid="connector-tool"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onPointerLeave={onPointerLeave}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg className="tool-svg" aria-hidden="true">
        {preview !== null && (
          <line
            className="connector-preview"
            data-testid="connector-preview"
            x1={preview.a.x}
            y1={preview.a.y}
            x2={preview.b.x}
            y2={preview.b.y}
          />
        )}
        {dots}
      </svg>
    </div>
  );
}
