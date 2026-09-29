// A connector — an arrow between two board objects (story 10 `connector.ui`).
//
// The arrow is drawn from its two ends *every time the board renders*: each attached
// end is resolved against the live rectangle of the object it is welded to, so a shape
// that a colleague drags across the board takes the arrow with it and its end jumps to
// whichever side now faces the other object, without one byte being written about the
// arrow (connector.follow). An end whose object is gone draws itself at the `fallback`
// point it was welded to, which is why a delete leaves a visible arrow rather than a
// broken one (connector.target_deleted).
//
// It is drawn as one SVG laid over its derived box: a line, a triangular arrowhead, and
// an invisible stroke twice the click tolerance wide — that stroke is what makes a click
// within `CONNECTOR_HIT_TOLERANCE_PX` *screen* pixels of the line select it, while a
// click inside the arrow's bounding box but far from the line selects nothing
// (connector.select). A selected arrow grows a handle at each end; dragging one re-welds
// that end to whatever object it is released on, or pins it to the board point it is
// released at, and refuses the object the *other* end is welded to by snapping back
// (connector.reattach).
//
// Selection, move, marquee, delete and undo come from stories 7 and 8 through the
// registry: a connector is not resizable and holds no text, and its stored x/y/size stay
// 0 because its box is derived.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ObjectProps } from './registry.tsx';
import {
  objectRectsOf,
  setConnectorEndpoint,
  type ConnectorEnd,
  type Endpoint,
} from '../../shared/objects/connector.ts';
import { sideAnchor, resolveEndpoints, type Side } from '../../shared/geometry/connector-geometry.ts';
import { distanceToPolyline } from '../../shared/geometry/polyline.ts';
import { type ObjectSnapshot } from '../../shared/board-model.ts';
import type { Point, Rect } from '../../shared/geometry.ts';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config.ts';
import { screenToWorld, type Camera } from '../canvas/camera.ts';
import { hitObjectAt } from '../tools/hitTarget.ts';

/**
 * The generic gesture takes a pointer event on an HTML element; an arrow is drawn in
 * SVG, so its events are handed over as the same event with the element type the
 * gesture expects. Nothing reads `currentTarget` — the gesture works from the client
 * coordinates and the object id.
 */
function asHtml(e: React.PointerEvent<SVGElement>): React.PointerEvent<HTMLElement> {
  return e as unknown as React.PointerEvent<HTMLElement>;
}

/** A connection dot or end handle, in CSS pixels (it does not scale with the board). */
const DOT_SIZE_PX = CONNECTOR_DOT_RADIUS_PX;
const HANDLE_SIZE_PX = 6;
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

export interface ConnectorObjectProps extends ObjectProps {
  /**
   * The live rectangle of every other object, which the board builds once per render
   * with `objectRectsOf`. Without it, the attached ends of *these* arrows resolve to
   * the fallback points they were welded to.
   */
  rects?: ReadonlyMap<string, Rect>;
  /** Every object on the board: what a dragged end can be welded to. */
  objects?: readonly ObjectSnapshot[];
}

/** World units per screen pixel at this zoom (a handle is a fixed size on screen). */
function px(zoom: number): number {
  return 1 / (zoom > 0 ? zoom : 1);
}

/** The two points an arrow is drawn between, from its snapshot ends and live rects. */
export function connectorDrawPoints(
  obj: Pick<ObjectSnapshot, 'x' | 'y' | 'from' | 'to'>,
  rects?: ReadonlyMap<string, Rect>,
): { from: Point; to: Point } {
  const { from, to } = obj;
  if (!from || !to) return { from: { x: obj.x, y: obj.y }, to: { x: obj.x, y: obj.y } };
  return resolveEndpoints({ from, to }, rects ?? new Map<string, Rect>());
}

/**
 * Is this world point on the arrow? The distance to its line, against the click
 * tolerance converted to board units at the current zoom: 6 screen pixels are 12 board
 * units at 50% zoom and 3 at 200%, which is what "close enough to click it" means on a
 * scaled board (connector.select).
 */
export function connectorHitTest(
  obj: ObjectSnapshot,
  worldPoint: Point,
  zoom = 1,
  rects?: ReadonlyMap<string, Rect>,
): boolean {
  const ends = connectorDrawPoints(obj, rects);
  return distanceToPolyline([ends.from, ends.to], worldPoint) <= CONNECTOR_HIT_TOLERANCE_PX * px(zoom);
}

/** The triangle at the head of the arrow, and where the line stops to meet it. */
function arrowhead(from: Point, to: Point, size: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len <= 0) return null; // a zero-length arrow draws nothing at all
  const ux = dx / len;
  const uy = dy / len;
  const back = Math.min(size, len); // an arrow shorter than its own head keeps a small one
  const base = { x: to.x - ux * back, y: to.y - uy * back };
  const half = back / 2;
  return {
    base,
    points: `${to.x},${to.y} ${base.x - uy * half},${base.y + ux * half} ${base.x + uy * half},${base.y - ux * half}`,
  };
}

/** A live re-attach drag of one end of this arrow. */
interface EndDrag {
  end: ConnectorEnd;
  /** Where the pointer is, in board units. */
  ghost: Point;
  /** The object releasing there would weld the end to. */
  target: string | null;
}

/**
 * The arrow, plus — while it is selected — a handle at each end that can be dragged onto
 * another object or onto empty board.
 */
export function ConnectorObject(props: ConnectorObjectProps) {
  const { obj, doc, zoom, selected } = props;
  const canEdit = props.canEdit ?? true;
  const rects = props.rects;
  const ends = connectorDrawPoints(obj, rects);
  const head = arrowhead(ends.from, ends.to, CONNECTOR_ARROWHEAD_SIZE_WORLD);
  const propsRef = useRef(props);
  propsRef.current = props;

  // The SVG is laid over the arrow's own box with a margin, so the arrowhead and the
  // clickable width near the ends are both inside it: `pad` covers the larger of the
  // head and the click tolerance at this zoom.
  const pad = Math.max(24 * px(zoom), CONNECTOR_ARROWHEAD_SIZE_WORLD * 2);
  const box: Rect = {
    x: Math.min(ends.from.x, ends.to.x) - pad,
    y: Math.min(ends.from.y, ends.to.y) - pad,
    width: Math.abs(ends.to.x - ends.from.x) + pad * 2,
    height: Math.abs(ends.to.y - ends.from.y) + pad * 2,
  };

  const [drag, setDrag] = useState<EndDrag | null>(null);
  const dragRef = useRef<EndDrag | null>(null);
  const dragging = drag !== null;

  // The board surface this arrow sits on: the pointer's page coordinates are turned
  // into board units relative to its top-left, exactly as the camera sees them.
  const surface = useCallback((): Element | null => {
    const el = document.querySelector('[data-testid="world-layer"]');
    return el?.closest('[data-testid="viewport"]') ?? null;
  }, []);

  /** The board point of a pointer event, in the coordinate space the camera uses. */
  const worldOf = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const vp = surface();
      const r = vp ? vp.getBoundingClientRect() : null;
      return screenToWorld(propsRef.current.camera as Camera, {
        x: e.clientX - (r?.left ?? 0),
        y: e.clientY - (r?.top ?? 0),
      });
    },
    [surface],
  );

  /** What a released end would land on: an object to weld to, or nothing. */
  const targetUnder = useCallback(
    (p: Point): string | null =>
      hitObjectAt(propsRef.current.objects ?? [], p, {
        zoom: propsRef.current.zoom,
        rects: propsRef.current.rects ?? objectRectsOf(propsRef.current.objects ?? []),
        except: obj.id,
      })?.id ?? null,
    [obj.id],
  );

  const startDrag = (end: ConnectorEnd) => (e: React.PointerEvent<SVGElement>) => {
    // The handle belongs to the arrow: pressing it selects nothing else, pans nothing
    // and starts no marquee.
    e.stopPropagation();
    e.preventDefault();
    if (!canEdit) return;
    const anchor = end === 'from' ? ends.from : ends.to;
    const next: EndDrag = { end, ghost: anchor, target: null };
    dragRef.current = next;
    setDrag(next);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const ghost = worldOf(e);
      const next: EndDrag = { ...d, ghost, target: targetUnder(ghost) };
      dragRef.current = next;
      setDrag(next);
    };
    const finish = (e: PointerEvent, cancelled: boolean) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d || cancelled) return; // a pointer that never landed writes nothing
      const point = worldOf(e);
      const target = targetUnder(point);
      const other = d.end === 'from' ? obj.to : obj.from;
      // Released on the object the *other* end is welded to: that would be an arrow with
      // no length, so the handle snaps back and nothing is written.
      if (target && other?.kind === 'attached' && target === other.objectId) return;
      const next: Endpoint = target
        ? { kind: 'attached', objectId: target, fallback: point }
        : { kind: 'free', x: point.x, y: point.y };
      // A connector deleted while its handle was in the air answers false: the
      // interaction simply ends (TC-29).
      setConnectorEndpoint(doc, obj.id, d.end, next);
    };
    const onUp = (e: PointerEvent) => finish(e, false);
    const onCancel = (e: PointerEvent) => finish(e, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // Bound once per drag; everything they act on is read through refs, so a move can
    // never use the state of the frame the drag began in.
  }, [dragging, doc, obj.id, obj.from, obj.to, worldOf, targetUnder]);

  const onPointerDown = (e: React.PointerEvent<SVGElement>) => {
    props.onObjectPointerDown(asHtml(e), obj.id);
  };
  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    // An arrow holds no text, so a double-click on one must not create a note behind it.
    e.stopPropagation();
  };

  // The four connection points of the object the dragged end is hovering over.
  const hoverRect = drag?.target ? rects?.get(drag.target) : undefined;

  return (
    <svg
      data-testid="connector-object"
      data-connector-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Connector"
      tabIndex={0}
      width={box.width}
      height={box.height}
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        overflow: 'visible',
        // The SVG box is only a canvas: clicks belong to what is painted on it, never to
        // the empty space around the line.
        pointerEvents: 'none',
        zIndex: obj.z,
        outline: selected ? '1px dashed rgba(47,111,237,0.5)' : 'none',
      }}
      onDoubleClick={onDoubleClick}
    >
      {/* The clickable width: twice the click tolerance in board units at this zoom. */}
      <line
        data-testid="connector-hit"
        x1={ends.from.x}
        y1={ends.from.y}
        x2={ends.to.x}
        y2={ends.to.y}
        stroke="transparent"
        strokeWidth={2 * CONNECTOR_HIT_TOLERANCE_PX * px(zoom)}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onPointerDown={onPointerDown}
      />
      {head ? (
        <line
          data-testid="connector-line"
          x1={ends.from.x}
          y1={ends.from.y}
          x2={head.base.x}
          y2={head.base.y}
          stroke={selected ? '#2f6fed' : '#263238'}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          style={{ pointerEvents: 'none' }}
        />
      ) : null}
      {head ? (
        <polygon
          data-testid="connector-head"
          points={head.points}
          fill={selected ? '#2f6fed' : '#263238'}
          style={{ pointerEvents: 'none' }}
        />
      ) : null}

      {/* Mid-drag: the end trails the pointer as a dashed line, and the object it would
          land on shows the four points an end can weld to. */}
      {drag ? (
        <line
          data-testid="connector-drag-preview"
          x1={(drag.end === 'from' ? ends.to : ends.from).x}
          y1={(drag.end === 'from' ? ends.to : ends.from).y}
          x2={drag.ghost.x}
          y2={drag.ghost.y}
          stroke="#2f6fed"
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeDasharray="6 4"
          style={{ pointerEvents: 'none' }}
        />
      ) : null}
      {drag && hoverRect
        ? SIDES.map((side) => {
            const p = sideAnchor(hoverRect, side);
            return (
              <circle
                key={side}
                data-testid={`connector-endpoint-${side}`}
                cx={p.x}
                cy={p.y}
                r={DOT_SIZE_PX * px(zoom)}
                fill="#2f6fed"
                style={{ pointerEvents: 'none' }}
              />
            );
          })
        : null}

      {/* Selected: one handle per end, the same size on screen at any zoom, each one
          draggable to weld that end somewhere else. */}
      {selected
        ? ([
            ['from', ends.from],
            ['to', ends.to],
          ] as [ConnectorEnd, Point][]).map(([end, p]) => (
          <circle
            key={end}
            data-testid={`connector-handle-${end}`}
            cx={p.x}
            cy={p.y}
            r={HANDLE_SIZE_PX * px(zoom)}
            fill="#ffffff"
            stroke="#2f6fed"
            strokeWidth={2 * px(zoom)}
            style={{ pointerEvents: 'all', cursor: 'crosshair' }}
            onPointerDown={startDrag(end)}
          />
        ))
        : null}
    </svg>
  );
}

/** The camera type, re-exported for the props docs of an object component. */
export type { Camera };

// `objects/registry.tsx` registers this component as the 'connector' type.
export default ConnectorObject;
