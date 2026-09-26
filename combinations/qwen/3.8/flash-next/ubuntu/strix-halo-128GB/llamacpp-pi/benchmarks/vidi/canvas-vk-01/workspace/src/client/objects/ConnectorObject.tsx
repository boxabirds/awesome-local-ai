import {
  useCallback,
  useEffect,
  useRef,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  DEFAULT_SHAPE_STROKE,
  HANDLE_SIZE_PX,
  SELECTION_COLOR,
  SHAPE_STROKE_COLORS,
} from '../../shared/config';
import { rectContains, type Point, type Rect } from '../../shared/geometry';
import {
  setConnectorEndpoint,
  type ConnectorEnd,
  type ConnectorSnapshot,
  type Endpoint,
} from '../../shared/objects/connector';
import { clientToWorld } from '../canvas/viewportPoint';
import { useUndoController } from '../board/UndoContext';
import type { ObjectProps } from './registry';

/**
 * How far the drawing box grows around the arrow, in world units. An arrow can
 * be exactly horizontal or vertical (a zero-height or zero-width box), so the
 * SVG needs room for its own stroke and arrowhead.
 */
const PAD = CONNECTOR_ARROWHEAD_SIZE_WORLD + CONNECTOR_STROKE_WIDTH_WORLD * 2;

/** The arrowhead colour: the board's standard outline colour. */
const ARROW_COLOR = SHAPE_STROKE_COLORS[DEFAULT_SHAPE_STROKE];

/** The arrowhead as a triangle: tip at `to`, legs pointing back along the line. */
function arrowHeadPoints(from: Point, to: Point): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  const back = (offset: number): string =>
    `${to.x + CONNECTOR_ARROWHEAD_SIZE_WORLD * Math.cos(angle + Math.PI + offset)},${
      to.y + CONNECTOR_ARROWHEAD_SIZE_WORLD * Math.sin(angle + Math.PI + offset)
    }`;
  return `${to.x},${to.y} ${back(-spread)} ${back(spread)}`;
}

/**
 * The object an arrow end may attach to at `worldPoint`, or null for empty
 * space. Arrows are not targets (they are not in `rects`); among overlapping
 * objects the last entry wins, which is the topmost in the order the model
 * assigns z in.
 */
function attachTarget(rects: ReadonlyMap<string, Rect>, worldPoint: Point): string | null {
  const dot: Rect = { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 };
  let found: string | null = null;
  for (const [id, rect] of rects) {
    if (rectContains(rect, dot)) found = id;
  }
  return found;
}

/**
 * An arrow between board objects (story 10). Its two ends come from the
 * snapshot, already resolved against the objects' current rectangles, so a move
 * or resize by anyone redraws the arrow on every screen with no write of its own
 * (`connector.follow`), and an end whose object is gone draws at its stored
 * fallback point (`connector.target_deleted`).
 *
 * Clicking within `CONNECTOR_HIT_TOLERANCE_PX` screen pixels of the line selects
 * the arrow (`connector.select`) — the wide transparent stroke below is the
 * clickable target, since the visible line is far too thin to aim at. A selected
 * arrow shows a handle at each end: drag one onto an object to attach it there,
 * onto empty space to fix it at that point (`connector.reattach`).
 */
export function ConnectorObject(props: ObjectProps): JSX.Element {
  const { obj, doc, zoom, camera, selected, editable, rects, onObjectPointerDown } = props;
  const connector = obj as ConnectorSnapshot;
  const undo = useUndoController();
  const width = Math.max(0, obj.width ?? 0);
  const height = Math.max(0, obj.height ?? 0);

  // Latest values for the window listeners attached during a handle drag.
  const latestRef = useRef({ camera, rects, editable, connector });
  useEffect(() => {
    latestRef.current = { camera, rects, editable, connector };
  });

  // Local drawing coordinates: the padded box, arrow inside it.
  const local = (point: Point): Point => ({
    x: point.x - obj.x + PAD,
    y: point.y - obj.y + PAD,
  });
  const from = local(connector.fromPoint);
  const to = local(connector.toPoint);
  const line = { x1: from.x, y1: from.y, x2: to.x, y2: to.y };

  const applyEnd = useCallback(
    (end: ConnectorEnd, client: Point) => {
      const current = latestRef.current;
      if (!current.editable) return;
      const world = clientToWorld(current.camera, client);
      if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return;
      const otherKey = end === 'from' ? 'to' : 'from';
      const other = current.connector[otherKey];
      const otherObjectId = other.kind === 'attached' ? other.objectId : null;
      const targetId = attachTarget(current.rects, world);
      // Released on the object the other end hangs off, or on nothing at all:
      // the end stays free at the release point.
      const next: Endpoint =
        targetId === null || targetId === otherObjectId
          ? { kind: 'free', x: world.x, y: world.y }
          : { kind: 'attached', objectId: targetId, fallback: world };
      setConnectorEndpoint(doc, current.connector.id, end, next);
    },
    [doc],
  );

  const startHandleDrag = (end: ConnectorEnd) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !editable) return;
    event.stopPropagation();
    event.preventDefault();
    const pointerId = event.pointerId ?? -1;
    let done = false;
    undo?.boundary();

    const cleanup = () => {
      if (done) return;
      done = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      // One undo step for the whole re-attach (`undo.gesture_boundaries`).
      undo?.boundary();
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === pointerId) moveEvent.preventDefault();
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      applyEnd(end, { x: upEvent.clientX, y: upEvent.clientY });
      cleanup();
    };
    const onCancel = () => cleanup();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  const handleSize = HANDLE_SIZE_PX / (zoom > 0 ? zoom : 1);
  const hitWidth = (CONNECTOR_HIT_TOLERANCE_PX * 2) / (zoom > 0 ? zoom : 1);

  return (
    <div
      role="group"
      aria-label="Arrow"
      data-testid={`connector-object-${connector.id}`}
      data-connector-id={connector.id}
      data-selected={selected ? 'true' : undefined}
      className="connector-object"
      style={{
        position: 'absolute',
        left: `${obj.x - PAD}px`,
        top: `${obj.y - PAD}px`,
        width: `${width + PAD * 2}px`,
        height: `${height + PAD * 2}px`,
        zIndex: obj.z,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={width + PAD * 2}
        height={height + PAD * 2}
        viewBox={`0 0 ${width + PAD * 2} ${height + PAD * 2}`}
        style={{ position: 'absolute', left: 0, top: 0, display: 'block', overflow: 'visible' }}
        aria-hidden="true"
      >
        {selected && (
          <line {...line} data-part="selection-halo" stroke={SELECTION_COLOR} strokeOpacity={0.4} strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD * 3} />
        )}
        <line {...line} data-part="arrow-line" stroke={ARROW_COLOR} strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD} strokeLinecap="round" />
        <polygon data-part="arrow-head" points={arrowHeadPoints(from, to)} fill={ARROW_COLOR} stroke="none" />
        <line
          {...line}
          data-testid={`connector-hit-${connector.id}`}
          stroke="transparent"
          strokeWidth={hitWidth}
          style={{ pointerEvents: 'stroke' }}
          onPointerDown={(event) => onObjectPointerDown(event, connector.id)}
        />
      </svg>
      {selected &&
        (['from', 'to'] as const).map((end) => {
          const point = end === 'from' ? from : to;
          return (
            <div
              key={end}
              role="button"
              aria-label={end === 'from' ? 'Arrow start' : 'Arrow end'}
              title="Drag onto an object to attach, onto empty space to detach"
              data-testid={`connector-handle-${end}`}
              data-end={end}
              className="connector-handle"
              style={{
                position: 'absolute',
                left: `${point.x - handleSize / 2}px`,
                top: `${point.y - handleSize / 2}px`,
                width: `${handleSize}px`,
                height: `${handleSize}px`,
                boxSizing: 'border-box',
                background: '#ffffff',
                border: `${1 / (zoom > 0 ? zoom : 1)}px solid ${SELECTION_COLOR}`,
                borderRadius: '50%',
                cursor: 'crosshair',
                pointerEvents: 'auto',
              }}
              onPointerDown={startHandleDrag(end)}
            />
          );
        })}
    </div>
  );
}
