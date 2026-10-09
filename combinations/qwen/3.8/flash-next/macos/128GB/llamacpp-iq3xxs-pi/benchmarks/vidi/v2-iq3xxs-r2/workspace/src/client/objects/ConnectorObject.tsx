import {
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { isConnectorSnapshot, setConnectorEndpoint } from '../../shared/objects/connector';
import type { ConnectorEnd, ConnectorSnapshot } from '../../shared/objects/connector';
import { pointInRect, type Point, type Rect } from '../../shared/geometry';
import { useUndoController } from '../board/useUndo';
import { SELECTION_OUTLINE, SELECTED_STACK_ABOVE } from './StickyNote';
import type { ObjectProps } from '../objects/registry';

/** The colour every arrow is drawn in. */
export const CONNECTOR_COLOUR = '#263238';
/** The side of a square end handle, in screen pixels (design: connector.reattach). */
export const CONNECTOR_HANDLE_PX = 12;
/**
 * How far the SVG reaches outside an arrow's box, in board units. An arrow's box is its two
 * ends, so its own outline — and the wide invisible stroke a click has to land on — gets
 * close to the edge of it; the SVG draws past the box by more than the widest tolerance can
 * be at any zoom the board allows.
 */
export const CONNECTOR_SVG_PADDING_WORLD = 120;

/**
 * One arrow (`connector.ui`): a straight line between two objects, an arrowhead at its end,
 * and — while this client has it selected — a handle at each end that can be dragged somewhere
 * else.
 *
 * It stores no line of its own. The board's snapshot says where each end is *now*, worked out
 * from where the objects it is attached to are now, so an arrow follows anybody's move without
 * a second write and without this component knowing anything about moves (design:
 * connector.follow). What is left here is the drawing, and the one interaction only an arrow
 * has: taking an end off its object and putting it on another.
 *
 * The line is thin, but the thing you can click is not: a transparent stroke
 * `CONNECTOR_HIT_TOLERANCE_PX` wider on each side, in board units divided by the zoom, is what
 * makes a click within six screen pixels of the arrow select it at any zoom — the same rule the
 * registry's hit test applies to a marquee (PRD: "Select an arrow precisely").
 */
export function ConnectorObject(props: ObjectProps): JSX.Element | null {
  if (!isConnectorSnapshot(props.object)) return null;
  return <ConnectorObjectBody {...props} connector={props.object} />;
}

interface ConnectorObjectBodyProps extends ObjectProps {
  connector: ConnectorSnapshot;
}

/** An end handle being dragged: which end, and where the pointer has got to. */
interface HandleDrag {
  readonly end: ConnectorEnd;
  /** The pointer's board point, tracked by adding its movement to where the press started. */
  readonly point: Point;
  readonly pointerClient: Point;
}

function ConnectorObjectBody({
  connector,
  doc,
  zoom,
  selected,
  editing,
  dragging,
  readOnly = false,
  onObjectPointerDown,
  rects,
  onSelect,
}: ConnectorObjectBodyProps): JSX.Element {
  const undo = useUndoController();
  const [handle, setHandle] = useState<HandleDrag | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  // The line follows the handle being dragged; otherwise it is where the document says.
  const from = handle?.end === 'from' ? handle.point : connector.ends.from;
  const to = handle?.end === 'to' ? handle.point : connector.ends.to;

  const width = Math.max(1, connector.width);
  const height = Math.max(1, connector.height);
  const pad = CONNECTOR_SVG_PADDING_WORLD;
  // The SVG's own coordinates: the box, moved by its padding.
  const at = (point: Point): Point => ({ x: point.x - connector.x + pad, y: point.y - connector.y + pad });
  const start = at(from);
  const end = at(to);

  /*
   * Pressing the line is a press on the arrow. It is the only part of the arrow's box that
   * takes the pointer at all (see the `pointerEvents` below): an arrow's box is its two ends,
   * which means the box is mostly empty board, and shapes under it have to stay reachable.
   */
  const onLinePointerDown = (event: ReactPointerEvent<SVGLineElement>): void => {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    event.stopPropagation();
    // Selecting, raising and — if the pointer then moves — dragging are the gesture's
    // business, as they are for every other type, including on a board this client may not
    // write to, where it selects and then refuses.
    onObjectPointerDown(event, connector.id);
  };

  /*
   * Pressing an end handle is not a request to move the whole arrow, so the handle stops the
   * press before it reaches the arrow's own handler.
   */
  const beginHandle = (which: ConnectorEnd) => (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation();
    if (pointerIdRef.current !== null) return;
    pointerIdRef.current = event.pointerId;
    const element = event.currentTarget;
    if (typeof element.setPointerCapture === 'function') {
      element.setPointerCapture(event.pointerId);
    }
    setHandle({ end: which, point: connector.ends[which], pointerClient: clientPoint(event) });
  };

  const moveHandle = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return;
    event.stopPropagation();
    const client = clientPoint(event);
    setHandle((current) =>
      current
        ? {
            ...current,
            // The world layer is scaled by the zoom, so a screen pixel of movement is
            // `1 / zoom` board units of it — which is the whole conversion, with no viewport
            // origin and no camera to keep in step.
            point: {
              x: current.point.x + (client.x - current.pointerClient.x) / (zoom || 1),
              y: current.point.y + (client.y - current.pointerClient.y) / (zoom || 1),
            },
            pointerClient: client,
          }
        : current,
    );
  };

  /*
   * The release decides what the end becomes (design: connector.reattach): over an object it
   * attaches to that object; over empty board it is fixed at the point it was released at; and
   * over the object at the *other* end of the same arrow the model refuses the change, which
   * is the snap back — nothing was written, so the handle returns to where the arrow still is.
   */
  const endHandle = (which: ConnectorEnd) => (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    event.stopPropagation();
    const current = handle;
    setHandle(null);
    if (!current || current.end !== which) return;
    const client = clientPoint(event);
    const point = {
      x: current.point.x + (client.x - current.pointerClient.x) / (zoom || 1),
      y: current.point.y + (client.y - current.pointerClient.y) / (zoom || 1),
    };
    const target = targetUnder(rects, point, connector.id);
    // One re-attach is one undo step, including the one that is refused and writes nothing.
    undo?.boundary();
    const done = setConnectorEndpoint(
      doc,
      connector.id,
      which,
      target ? { kind: 'attached', objectId: target, fallback: point } : { kind: 'free', x: point.x, y: point.y },
    );
    undo?.boundary();
    if (done) onSelect(connector.id);
  };

  const cancelHandle = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    event.stopPropagation();
    // Thrown away: the end stays where the document still says it is.
    setHandle(null);
  };

  const head = arrowHead(start, end);
  const style: CSSProperties = {
    position: 'absolute',
    left: `${connector.x}px`,
    top: `${connector.y}px`,
    width: `${width}px`,
    height: `${height}px`,
    // The box is drawn outside its own edges so a near-miss click reaches the wide stroke.
    overflow: 'visible',
    zIndex: selected ? SELECTED_STACK_ABOVE : connector.z,
    outlineWidth: selected ? '2px' : '0',
    outlineColor: SELECTION_OUTLINE,
    // Neither the box nor the svg takes the pointer: only the line does, and the handles.
    pointerEvents: 'none',
  };

  // Six screen pixels on each side of the line, in the board units that make at this zoom.
  const hitWidth = (CONNECTOR_HIT_TOLERANCE_PX * 2) / (zoom || 1);

  // On top of the `data-note-*` attributes every object carries, an arrow reports where its
  // ends are drawn and which side of its object each sits on, in board units: the resolved
  // answer the snapshot worked out, so a test (or a screen reader) can follow an arrow without
  // repeating the geometry.
  return (
    <div
      className="vidi6-connector"
      data-testid="connector-object"
      data-note-id={connector.id}
      data-note-type="connector"
      data-note-x={connector.x}
      data-note-y={connector.y}
      data-note-z={connector.z}
      data-note-width={width}
      data-note-height={height}
      data-connector-from-kind={connector.from.kind}
      data-connector-to-kind={connector.to.kind}
      data-connector-from-object={connector.from.kind === 'attached' ? connector.from.objectId : ''}
      data-connector-to-object={connector.to.kind === 'attached' ? connector.to.objectId : ''}
      data-connector-from-x={connector.ends.from.x}
      data-connector-from-y={connector.ends.from.y}
      data-connector-to-x={connector.ends.to.x}
      data-connector-to-y={connector.ends.to.y}
      data-connector-from-side={connector.sides.from ?? ''}
      data-connector-to-side={connector.sides.to ?? ''}
      data-connector-orphaned={connector.orphaned.from || connector.orphaned.to ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label={arrowLabel(connector)}
      style={style}
    >
      <svg
        className="vidi6-connector-svg"
        data-testid="connector-svg"
        width={width + pad * 2}
        height={height + pad * 2}
        style={{
          position: 'absolute',
          left: `${-pad}px`,
          top: `${-pad}px`,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        {/* The click target is drawn first, so the visible line and its head sit on top. */}
        <line
          data-testid="connector-hit"
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke="transparent"
          strokeWidth={hitWidth}
          pointerEvents="stroke"
          onPointerDown={onLinePointerDown}
        />
        <line
          data-testid="connector-line"
          x1={start.x}
          y1={start.y}
          x2={head.tail.x}
          y2={head.tail.y}
          stroke={CONNECTOR_COLOUR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          pointerEvents="none"
        />
        <polygon
          data-testid="connector-arrowhead"
          points={head.points}
          fill={CONNECTOR_COLOUR}
          pointerEvents="none"
        />
      </svg>
      {selected && !dragging
        ? (['from', 'to'] as const).map((which) => {
            const point = at(which === 'from' ? from : to);
            // Handles keep their size on screen, which means shrinking in board units.
            const size = CONNECTOR_HANDLE_PX / (zoom || 1);
            const stroke = CONNECTOR_HANDLE_PX / 6 / (zoom || 1);
            return (
              <div
                key={which}
                className="vidi6-connector-handle"
                data-testid={`connector-handle-${which}`}
                data-connector-end={which}
                role="button"
                aria-label={which === 'from' ? 'Start of arrow' : 'End of arrow'}
                tabIndex={0}
                style={{
                  position: 'absolute',
                  left: `${point.x - pad - size / 2}px`,
                  top: `${point.y - pad - size / 2}px`,
                  width: `${size}px`,
                  height: `${size}px`,
                  border: `${stroke}px solid ${SELECTION_OUTLINE}`,
                  borderRadius: '50%',
                  background: '#ffffff',
                  cursor: 'grab',
                  touchAction: 'none',
                  // The arrow's own box lets the pointer through, so the handle asks for it back.
                  pointerEvents: 'auto',
                }}
                onPointerDown={beginHandle(which)}
                onPointerMove={moveHandle}
                onPointerUp={endHandle(which)}
                onPointerCancel={cancelHandle}
              />
            );
          })
        : null}
    </div>
  );
}

/** What an arrow is called out as (PRD: shapes and arrows are announced with their kind). */
export function arrowLabel(connector: ConnectorSnapshot): string {
  return connector.orphaned.from || connector.orphaned.to ? 'Arrow with a loose end' : 'Arrow';
}

/**
 * The arrowhead: a triangle whose tip is the arrow's end and whose corners sit one head's
 * length back along the line (`CONNECTOR_ARROWHEAD_SIZE_WORLD`). The line is drawn to that
 * head's back rather than to the tip, so it does not stick out through it.
 */
export function arrowHead(
  from: Point,
  to: Point,
  size: number = CONNECTOR_ARROWHEAD_SIZE_WORLD,
): { points: string; tail: Point } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // An arrow with no length has no direction to point at; it is drawn a line of none.
  if (dx === 0 && dy === 0) return { points: '', tail: to };
  const angle = Math.atan2(dy, dx);
  const spread = Math.PI / 8;
  const corner = (which: number): Point => ({
    x: to.x - size * Math.cos(angle - which * spread),
    y: to.y - size * Math.sin(angle - which * spread),
  });
  const left = corner(1);
  const right = corner(-1);
  const tail = { x: to.x - size * Math.cos(angle), y: to.y - size * Math.sin(angle) };
  const at = (point: Point): string => `${point.x},${point.y}`;
  return { points: `${at(to)} ${at(left)} ${at(right)}`, tail };
}

/**
 * Which object a board point is over, from the boxes the board passes down (design:
 * connector.reattach). The arrow whose handle is being dragged is skipped — an arrow's box is
 * its ends, which makes it a box mostly full of empty board.
 */
export function targetUnder(
  rects: ReadonlyMap<string, Rect> | undefined,
  point: Point,
  skip: string,
): string | null {
  if (!rects) return null;
  for (const [id, rect] of rects) {
    if (id === skip) continue;
    if (pointInRect(rect, point)) return id;
  }
  return null;
}

function clientPoint(event: { clientX: number; clientY: number }): Point {
  return { x: event.clientX, y: event.clientY };
}
