import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import type * as Y from 'yjs';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  HANDLE_SIZE_PX,
  SHAPE_STROKE_COLORS,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import {
  connectorBBox,
  nearestSide,
  rectCenter,
  resolveEndpoints,
  sideAnchor,
} from '../../shared/geometry/connector-geometry';
import { type ConnectorSnap, type Endpoint, setConnectorEndpoint } from '../../shared/objects/connector';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';

const PRIMARY_BUTTON = 0;
const EMPTY_RECTS: ReadonlyMap<string, Rect> = new Map();

type End = 'from' | 'to';

/** The topmost object (last in stacking order) whose rect contains `p`. */
export function objectAt(rects: ReadonlyMap<string, Rect>, p: Point): string | null {
  let hit: string | null = null;
  for (const [id, r] of rects) {
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) hit = id;
  }
  return hit;
}

/** Line (ending at the arrowhead's base) and arrowhead triangle, in world units. */
export function arrowGeometry(from: Point, to: Point, size = CONNECTOR_ARROWHEAD_SIZE_WORLD) {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len === 0) return { lineEnd: to, head: [to, to, to] as const };
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  const head = Math.min(size, len);
  const base = { x: to.x - ux * head, y: to.y - uy * head };
  const half = head / 2;
  return {
    lineEnd: base,
    head: [
      to,
      { x: base.x - uy * half, y: base.y + ux * half },
      { x: base.x + uy * half, y: base.y - ux * half },
    ] as const,
  };
}

interface HandleDrag {
  end: End;
  pointerId: number;
  startClient: Point;
  startWorld: Point;
  point: Point;
}

/**
 * A straight arrow with an arrowhead at its `to` end (story 10). Both ends are resolved from
 * the current object rects on every render, so the arrow follows moves and resizes by anyone.
 * The arrow itself takes no pointer events (the board picks it by distance to its line); when
 * selected it shows a handle at each end, which re-attaches the end to the object it is dropped
 * on, or frees it on empty space. Dropping on the object at the other end snaps back.
 */
export function ConnectorObject(
  props: {
    connector: ConnectorSnap;
    rects: ReadonlyMap<string, Rect>;
    doc: Y.Doc;
    selected: boolean;
    zoom: number;
  } & Partial<Omit<ObjectProps, 'object' | 'doc' | 'selected' | 'zoom' | 'rects'>>,
) {
  const { connector, rects, selected, zoom } = props;
  const editable = props.editable ?? true;
  const history = useUndoController();
  const [drag, setDrag] = useState<HandleDrag | null>(null);
  const dragRef = useRef<HandleDrag | null>(null);
  const detachRef = useRef<() => void>(() => {});
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => () => detachRef.current(), []);

  // While a handle is dragged, that end is drawn at the pointer.
  const shown = drag
    ? { ...connector, [drag.end]: { kind: 'free', x: drag.point.x, y: drag.point.y } as Endpoint }
    : connector;
  const ends = resolveEndpoints(shown, rects);
  const box = connectorBBox(ends.from, ends.to);
  const local = (p: Point) => ({ x: p.x - box.x, y: p.y - box.y });
  const { lineEnd, head } = arrowGeometry(ends.from, ends.to);
  const a = local(ends.from);
  const b = local(lineEnd);
  const color = SHAPE_STROKE_COLORS.dark;

  // Drop target while dragging a handle: its nearest side is highlighted.
  let target: { id: string; anchor: Point } | null = null;
  if (drag) {
    const id = objectAt(rects, drag.point);
    const other = connector[drag.end === 'from' ? 'to' : 'from'];
    if (id && !(other.kind === 'attached' && other.objectId === id)) {
      const r = rects.get(id)!;
      const otherPoint = ends[drag.end === 'from' ? 'to' : 'from'];
      const toward = other.kind === 'attached' && rects.has(other.objectId) ? rectCenter(rects.get(other.objectId)!) : otherPoint;
      target = { id, anchor: sideAnchor(r, nearestSide(r, toward)) };
    }
  }

  const finishDrag = (d: HandleDrag, commit: boolean) => {
    detachRef.current();
    detachRef.current = () => {};
    dragRef.current = null;
    setDrag(null);
    if (!commit) return;
    const { connector: c, rects: currentRects, doc: currentDoc } = propsRef.current;
    const other = c[d.end === 'from' ? 'to' : 'from'];
    const id = objectAt(currentRects, d.point);
    // Released on the object at the other end: rejected, the handle snaps back.
    if (id && other.kind === 'attached' && other.objectId === id) return;
    const next: Endpoint = id
      ? { kind: 'attached', objectId: id, fallback: d.point }
      : { kind: 'free', x: d.point.x, y: d.point.y };
    history?.boundary();
    // False when the arrow was deleted meanwhile (or nothing changed): the interaction just ends.
    setConnectorEndpoint(currentDoc, c.id, d.end, next);
    history?.boundary();
  };

  const onHandlePointerDown = (e: ReactPointerEvent<SVGElement>, end: End) => {
    e.stopPropagation();
    if (e.button !== PRIMARY_BUTTON || !editable) return;
    e.preventDefault();
    const d: HandleDrag = {
      end,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: ends[end],
      point: ends[end],
    };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Already released.
    }
    const at = (ev: PointerEvent): Point => ({
      x: d.startWorld.x + (ev.clientX - d.startClient.x) / propsRef.current.zoom,
      y: d.startWorld.y + (ev.clientY - d.startClient.y) / propsRef.current.zoom,
    });
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId || dragRef.current !== d) return;
      d.point = at(ev);
      setDrag({ ...d });
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId || dragRef.current !== d) return;
      d.point = at(ev);
      finishDrag(d, true);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId || dragRef.current !== d) return;
      finishDrag(d, false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    detachRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    dragRef.current = d;
    setDrag(d);
  };

  const style = {
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    zIndex: props.layer,
  } as CSSProperties;
  const showHandles = selected && editable && !props.transforming;
  const handleRadius = HANDLE_SIZE_PX / 2 / zoom;
  const classes = ['connector-object'];
  if (selected) classes.push('is-selected');
  if (drag) classes.push('is-reattaching');

  return (
    <div
      className={classes.join(' ')}
      role="group"
      aria-roledescription="Arrow"
      aria-label="Arrow"
      tabIndex={0}
      data-object-id={connector.id}
      data-connector-id={connector.id}
      data-selected={selected}
      data-from={`${ends.from.x},${ends.from.y}`}
      data-to={`${ends.to.x},${ends.to.y}`}
      style={style}
      onFocus={(e) => {
        if (e.target === e.currentTarget && !selected) props.onSelect?.(connector.id);
      }}
    >
      <svg className="connector-svg" width={Math.max(box.width, 1)} height={Math.max(box.height, 1)} aria-hidden="true">
        {selected && (
          <line
            className="connector-selection"
            x1={a.x}
            y1={a.y}
            x2={local(ends.to).x}
            y2={local(ends.to).y}
            strokeWidth={(CONNECTOR_STROKE_WIDTH_WORLD * 2 + 4 / zoom)}
          />
        )}
        <line
          className="connector-line"
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={color}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeLinecap="round"
        />
        <polygon
          className="connector-head"
          points={head.map((p) => `${local(p).x},${local(p).y}`).join(' ')}
          fill={color}
          stroke={color}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD / 2}
          strokeLinejoin="round"
        />
        {target && (
          <circle
            className="connector-dot is-highlighted"
            data-target-id={target.id}
            cx={local(target.anchor).x}
            cy={local(target.anchor).y}
            r={(CONNECTOR_DOT_RADIUS_PX * 1.5) / zoom}
          />
        )}
      </svg>
      {showHandles &&
        (['from', 'to'] as const).map((end) => (
          <svg
            key={end}
            className="connector-handle-svg"
            width={1}
            height={1}
            aria-hidden="false"
            style={{ left: local(ends[end]).x, top: local(ends[end]).y }}
          >
            <circle
              role="button"
              aria-label={end === 'from' ? 'Arrow start' : 'Arrow end'}
              className="connector-handle"
              data-connector-handle={end}
              cx={0}
              cy={0}
              r={handleRadius}
              strokeWidth={1.5 / zoom}
              onPointerDown={(e) => onHandlePointerDown(e, end)}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          </svg>
        ))}
    </div>
  );
}

/** Registry adapter: the board's generic object props to ConnectorObject. */
export function ConnectorEntry(props: ObjectProps) {
  const { object, rects, ...rest } = props;
  return <ConnectorObject {...rest} connector={object as ConnectorSnap} rects={rects ?? EMPTY_RECTS} />;
}
