/**
 * Story 10: the arrow between two objects.
 *
 * A connector draws nothing it stores. Its line is derived, every frame, from the boxes
 * of whatever is at each end — the board's snapshot rects — which is the whole of
 * "arrows follow shapes": somebody moves a shape, story 3 delivers the change, the
 * snapshot recomputes the rects, and this component draws the arrow at the sides that
 * now face the other end. No write, on any screen, ever.
 *
 * Two details are worth the words:
 *
 * - **The hit area is the line, not the box.** An arrow's bounding box can be enormous —
 *   a diagonal across the whole board — and clicking inside it means nothing. So the
 *   drawing is a thin visible line plus an invisible stroke twelve screen pixels wide,
 *   and a press is only a selection if it lands within six of the line (the stroke width
 *   is that same rule, stated as a shape). The press handler re-checks the distance in
 *   board units, so it is one rule rather than a browser courtesy.
 * - **A selected arrow offers its ends.** Two handles, draggable on to another object to
 *   re-attach, or on to empty space to let go. Releasing over the object at the *other*
 *   end is refused by the model, and the handle snaps back — which is what makes an
 *   arrow from A to A impossible to make by accident.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { nearestSide, resolveEndpoints, sideAnchor } from '../../shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import {
  isConnectorSnapshot,
  setConnectorEndpoint,
  type ConnectorEndpoint,
  type ConnectorSnapshot,
} from '../../shared/objects/connector';
import { useBoardEnv, type BoardEnv } from '../board/boardEnv';
import { useUndoController } from '../board/useUndo';
import { hitTestObject, type ObjectProps } from './registry';

/**
 * How far the drawing sticks out past the two ends: the arrowhead at one, the handles at
 * both. The box is the box of the ends, so without this the head would be clipped.
 */
const DRAW_PAD_WORLD = CONNECTOR_ARROWHEAD_SIZE_WORLD * 2;

export interface ConnectorObjectProps extends ObjectProps {
  /** Narrowed for you by the registry; a connector always carries it. */
  connector?: ConnectorSnapshot;
}

export function ConnectorObject(props: ConnectorObjectProps) {
  const connector = props.connector ?? (isConnectorSnapshot(props.object) ? props.object : null);
  if (!connector) return null;
  return <ConnectorArrow {...props} connector={connector} />;
}

/** The arrow itself, with its snapshot already narrowed to one. */
function ConnectorArrow(props: Required<Pick<ConnectorObjectProps, 'connector'>> & ConnectorObjectProps) {
  const { connector, doc, zoom, selected, editable, onObjectPointerDown } = props;
  const env = useBoardEnv();
  const undo = useUndoController();
  const rects = env?.rects ?? EMPTY_RECTS;
  const ends = resolveEndpoints(connector, rects);
  const box = boxOf(ends.from, ends.to);
  // The end being dragged, and where the pointer has got to. The arrow follows the
  // pointer while you drag, and goes back where it was if the release is refused.
  const [dragEnd, setDragEnd] = useState<{ end: 'from' | 'to'; point: Point } | null>(null);
  const dragRef = useRef(dragEnd);
  dragRef.current = dragEnd;

  const drawn: { from: Point; to: Point } = dragEnd
    ? {
        from: dragEnd.end === 'from' ? dragEnd.point : ends.from,
        to: dragEnd.end === 'to' ? dragEnd.point : ends.to,
      }
    : ends;

  // Half the invisible stroke is the click tolerance, in board units: six screen
  // pixels, whatever the zoom.
  const hitWidth = (CONNECTOR_HIT_TOLERANCE_PX * 2) / zoom;

  const onLinePointerDown = (event: ReactPointerEvent<SVGLineElement>) => {
    if (!env) {
      // Drawn outside a board: nothing to convert the press with, so take it as it is.
      onObjectPointerDown(event, connector.id);
      return;
    }
    const world = env.toWorld({ x: event.clientX, y: event.clientY });
    if (distanceToPolyline([drawn.from, drawn.to], world) > CONNECTOR_HIT_TOLERANCE_PX / zoom) {
      // Inside the box, nowhere near the line: the click belongs to the board.
      return;
    }
    onObjectPointerDown(event, connector.id);
  };

  const beginHandleDrag = (end: 'from' | 'to') => (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!editable || !selected || !env) return;
    event.stopPropagation();
    event.preventDefault();
    setDragEnd({ end, point: end === 'from' ? ends.from : ends.to });
  };

  const endHandleDrag = useCallback(
    (point: Point | null) => {
      const current = dragRef.current;
      dragRef.current = null;
      if (!current || !env) {
        setDragEnd(null);
        return;
      }
      if (point === null) {
        // Cancelled: the end stays where it was.
        setDragEnd(null);
        return;
      }
      const target = targetAt(env, point, connector.id);
      const next = endAt(point, target, rects, otherEnd(connector, current.end));
      // One drag of one end is one undo step.
      undo?.boundary();
      setConnectorEndpoint(doc, connector.id, current.end, next);
      undo?.boundary();
      setDragEnd(null);
    },
    [connector, doc, env, rects, undo],
  );

  // The drag runs on the window, not on the handle: the pointer is expected to leave the
  // handle, and the handle may well end up under another object.
  useEffect(() => {
    if (!dragEnd) return;
    const onMove = (event: PointerEvent) => {
      if (!env) return;
      setDragEnd({ end: dragRef.current?.end ?? 'to', point: env.toWorld({ x: event.clientX, y: event.clientY }) });
    };
    const onUp = (event: PointerEvent) => {
      endHandleDrag(env ? env.toWorld({ x: event.clientX, y: event.clientY }) : null);
    };
    const onCancel = () => endHandleDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [dragEnd, endHandleDrag, env]);

  return (
    <div
      className="connector-object"
      role="group"
      aria-label="Connector"
      data-object-id={connector.id}
      data-object-type="connector"
      data-selected={selected ? 'true' : 'false'}
      style={
        {
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          zIndex: connector.z,
          pointerEvents: 'none',
        } as CSSProperties
      }
    >
      <svg
        className="connector-object__svg"
        width={box.width}
        height={box.height}
        viewBox={`0 0 ${Math.max(0.001, box.width)} ${Math.max(0.001, box.height)}`}
        data-testid={`connector-${connector.id}`}
        style={{ overflow: 'visible' } as CSSProperties}
      >
        <ConnectorMark
          from={sub(drawn.from, box)}
          to={sub(drawn.to, box)}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          headSize={CONNECTOR_ARROWHEAD_SIZE_WORLD}
        />
        {/* The click band: invisible, and as wide as the rule about how close a click has
            to be. `stroke`, not `all`, so the empty middle of a long arrow's box — most
            of the board — is left to whatever is underneath. */}
        <line
          className="connector-object__hit"
          data-testid={`connector-hit-${connector.id}`}
          x1={drawn.from.x - box.x}
          y1={drawn.from.y - box.y}
          x2={drawn.to.x - box.x}
          y2={drawn.to.y - box.y}
          strokeWidth={hitWidth}
          onPointerDown={onLinePointerDown}
        />
        {selected
          ? (['from', 'to'] as const).map((end) => {
              const at =
                dragEnd && dragEnd.end === end
                  ? dragEnd.point
                  : end === 'from'
                    ? ends.from
                    : ends.to;
              return (
                <circle
                  key={end}
                  className="connector-object__handle"
                  data-testid={`connector-handle-${end}`}
                  data-end={end}
                  cx={at.x - box.x}
                  cy={at.y - box.y}
                  r={CONNECTOR_DOT_RADIUS_PX / zoom}
                  style={{ pointerEvents: editable ? 'all' : 'none' } as CSSProperties}
                  onPointerDown={beginHandleDrag(end)}
                />
              );
            })
          : null}
      </svg>
    </div>
  );
}

const EMPTY_RECTS: ReadonlyMap<string, Rect> = new Map();

/**
 * The arrow itself: a line that stops where its head begins, and a head that points
 * along the line. Both in the box's own coordinates, both sized in board units — so a
 * zoomed arrow has a proportionally bigger head, the way a drawn arrow does.
 */
export function ConnectorMark({
  from,
  to,
  strokeWidth,
  headSize,
}: {
  from: Point;
  to: Point;
  strokeWidth: number;
  headSize: number;
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  // A head can only point somewhere if there is a line to point along.
  const ux = length > 0 ? dx / length : 0;
  const uy = length > 0 ? dy / length : 0;
  const head = Math.min(headSize, length);
  const base = { x: to.x - ux * head, y: to.y - uy * head };
  const half = head * 0.4;
  const left = { x: base.x - uy * half, y: base.y + ux * half };
  const right = { x: base.x + uy * half, y: base.y - ux * half };
  return (
    <g className="connector-object__mark">
      <line
        className="connector-object__line"
        data-testid="connector-line"
        x1={from.x}
        y1={from.y}
        x2={base.x}
        y2={base.y}
        strokeWidth={strokeWidth}
      />
      <polygon
        className="connector-object__head"
        data-testid="connector-head"
        points={`${to.x},${to.y} ${left.x},${left.y} ${right.x},${right.y}`}
      />
    </g>
  );
}

/** The box two points need, including the room the head and handles stick out by. */
function boxOf(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x) - DRAW_PAD_WORLD,
    y: Math.min(a.y, b.y) - DRAW_PAD_WORLD,
    width: Math.abs(a.x - b.x) + DRAW_PAD_WORLD * 2,
    height: Math.abs(a.y - b.y) + DRAW_PAD_WORLD * 2,
  };
}

function sub(p: Point, box: Rect): Point {
  return { x: p.x - box.x, y: p.y - box.y };
}

/** The end an arrow handle is *not* being dragged: onto its own object is refused. */
function otherEnd(connector: ConnectorSnapshot, end: 'from' | 'to'): ConnectorEndpoint {
  return end === 'from' ? connector.to : connector.from;
}

/** What object (if any) a board point is on, this arrow excepted, topmost first. */
function targetAt(env: BoardEnv, point: Point, exceptId: string): string | null {
  let best: ObjectSnapshot | null = null;
  for (const object of env.objects) {
    if (object.id === exceptId) continue;
    if (!hitTestObject(object, point, { zoom: env.camera.zoom, rects: env.rects })) continue;
    if (!best || object.z >= best.z) best = object;
  }
  return best?.id ?? null;
}

/** What a release at `point` over `objectId` means, as one end of an arrow. */
function endAt(
  point: Point,
  objectId: string | null,
  rects: ReadonlyMap<string, Rect>,
  other: ConnectorEndpoint,
): ConnectorEndpoint {
  if (objectId === null) return { kind: 'free', x: point.x, y: point.y };
  const rect = rects.get(objectId);
  if (!rect) return { kind: 'free', x: point.x, y: point.y };
  // The side to hang from faces the other end of the arrow — the object at the other
  // end counts as sitting at its own centre, which is what `resolveEndpoints` does too.
  const otherRect = other.kind === 'attached' ? rects.get(other.objectId) : undefined;
  const toward = other.kind === 'free' ? { x: other.x, y: other.y } : centreOf(otherRect) ?? point;
  const anchor = sideAnchor(rect, nearestSide(rect, toward));
  return { kind: 'attached', objectId, fallbackX: anchor.x, fallbackY: anchor.y };
}

function centreOf(rect: Rect | undefined): Point | null {
  if (!rect) return null;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
