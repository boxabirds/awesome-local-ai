import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import type { ConnectorSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import type { EndEditNext } from '../board/useSelection';

export interface ConnectorObjectProps {
  /** The connector as stored, with its resolved ends already worked out. */
  obj: ConnectorSnapshot;
  doc: Y.Doc;
  /** Camera zoom: an arrow's line and head are board units, like a shape's outline. */
  zoom: number;
  selected: boolean;
  /** Never true for a connector — there is nothing in it to type into — but the
   * board hands the same props to every object. */
  editing?: boolean;
  canEdit?: boolean;
  onSelect(id: string): void;
  /** Shift+click toggles the arrow in and out of the selection. */
  onToggle?(id: string): void;
  onStartEdit?(id: string): void;
  onEndEdit?(next: EndEditNext): void;
  /** Transform gesture handlers: called for pointer events on this object. */
  onGesturePointerDown?(e: ReactPointerEvent<HTMLDivElement>, id: string): void;
  onGesturePointerMove?(e: ReactPointerEvent<HTMLDivElement>): void;
  onGesturePointerUp?(e: ReactPointerEvent<HTMLDivElement>): void;
  onGesturePointerCancel?(e: ReactPointerEvent<HTMLDivElement>): void;
}

/** How far outside the box the line and its head are allowed to reach: half the
 *  line's own width, so a stroke centred on the box's edge is not clipped. */
const OVERFLOW = CONNECTOR_STROKE_WIDTH_WORLD;

/**
 * One arrow between two shapes (design section 5.2).
 *
 * The two ends it stores are the two shapes and the sides it touches, which is
 * where the arrow lives; what it draws is the `resolved` pair the model worked
 * out from those — the anchor of the side it is attached to, or the free point it
 * was left with. A shape's component reads a box and paints it; this one reads
 * two points and draws the line between them, which is why the box underneath it
 * is only ever where the arrow happens to be at the moment.
 *
 * The hit area is deliberately wider than the line: a connector's own hit test
 * (model side) is a corridor around the polyline, and the transparent wide stroke
 * drawn here is the same corridor, so the place you can click is the place the
 * board says there is an arrow.
 */
export function ConnectorObject(props: ConnectorObjectProps): JSX.Element {
  const propsRef = useRef(props);
  const { obj, selected } = props;
  const zoom = props.zoom;

  useLayoutEffect(() => {
    propsRef.current = props;
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A press on an arrow is never a pan.
    e.stopPropagation();
    if (e.shiftKey) {
      propsRef.current.onToggle?.(obj.id);
      return;
    }
    propsRef.current.onGesturePointerDown?.(e, obj.id);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    propsRef.current.onGesturePointerMove?.(e);
  };

  const endPress = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (e.type === 'pointerup') propsRef.current.onGesturePointerUp?.(e);
    else propsRef.current.onGesturePointerCancel?.(e);
    propsRef.current.onSelect(obj.id);
  };

  const from = obj.resolved.from;
  const to = obj.resolved.to;
  const box = { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  const style = {
    left: `${box.x - OVERFLOW}px`,
    top: `${box.y - OVERFLOW}px`,
    width: `${box.width + OVERFLOW * 2}px`,
    height: `${box.height + OVERFLOW * 2}px`,
    zIndex: obj.z,
  } as CSSProperties;

  // Everything is drawn in the box's own coordinates, so the one transform of
  // the world layer scales the arrow with the board.
  const ax = from.x - box.x + OVERFLOW;
  const ay = from.y - box.y + OVERFLOW;
  const bx = to.x - box.x + OVERFLOW;
  const by = to.y - box.y + OVERFLOW;

  return (
    <div
      className={`connector-object${obj.detached ? ' is-detached' : ''}${selected ? ' is-selected' : ''}`}
      data-connector-id={obj.id}
      data-detached={obj.detached ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      // Where the two ends are, in board units, and what each one is: the seam
      // the browser tests read, because "the arrow still ends where that shape's
      // side was" is a statement about those numbers and nothing else.
      data-from-x={obj.resolved.from.x}
      data-from-y={obj.resolved.from.y}
      data-from-kind={obj.attached.from ? 'attached' : 'free'}
      data-to-x={obj.resolved.to.x}
      data-to-y={obj.resolved.to.y}
      data-to-kind={obj.attached.to ? 'attached' : 'free'}
      data-testid="connector-object"
      role="group"
      aria-label="Connector"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onLostPointerCapture={endPress}
    >
      <svg
        className="connector-svg"
        data-testid="connector-svg"
        width={box.width + OVERFLOW * 2}
        height={box.height + OVERFLOW * 2}
        viewBox={`0 0 ${box.width + OVERFLOW * 2} ${box.height + OVERFLOW * 2}`}
        aria-hidden="true"
        focusable="false"
      >
        <line
          className="connector-hit"
          data-testid="connector-hit"
          x1={ax}
          y1={ay}
          x2={bx}
          y2={by}
          // The click corridor is stated in screen pixels, so the world width it
          // has to be drawn at depends on how big a world unit is on the screen
          // right now. It is twice the tolerance the model measures a click
          // against, which is the one way the board's idea of a clickable arrow
          // and the pointer's agree at every zoom.
          strokeWidth={(CONNECTOR_HIT_TOLERANCE_PX * 2) / (props.zoom > 0 ? props.zoom : 1)}
        />
        <line
          className="connector-line"
          data-testid="connector-line"
          x1={ax}
          y1={ay}
          x2={bx}
          y2={by}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        />
        <polygon className="connector-head" data-testid="connector-head" points={arrowheadPoints({ x: ax, y: ay }, { x: bx, y: by })} />
      </svg>
    </div>
  );
}

/**
 * The three points of the arrowhead at the end of the line, as a filled triangle
 * whose point is the endpoint and whose base is the head's length back along it.
 *
 * It is drawn rather than defined as an SVG marker because a marker has to be
 * given an id and looked up by it, and a board with a hundred arrows on it would
 * have a hundred elements all claiming the same one.
 */
export function arrowheadPoints(from: Point, to: Point, size = CONNECTOR_ARROWHEAD_SIZE_WORLD): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return `${to.x},${to.y} ${to.x},${to.y} ${to.x},${to.y}`;
  // Unit vector along the line, and the vector at right angles to it.
  const ux = dx / length;
  const uy = dy / length;
  const back = size;
  const half = size / 2;
  const baseX = to.x - ux * back;
  const baseY = to.y - uy * back;
  return [
    `${to.x},${to.y}`,
    `${baseX - uy * half},${baseY + ux * half}`,
    `${baseX + uy * half},${baseY - ux * half}`,
  ].join(' ');
}
