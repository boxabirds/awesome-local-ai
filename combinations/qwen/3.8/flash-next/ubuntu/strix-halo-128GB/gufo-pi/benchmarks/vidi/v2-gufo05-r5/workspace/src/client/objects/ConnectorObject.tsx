/**
 * A connector on the board (story 10): an arrow between two objects, with handles on its ends.
 *
 * The line is drawn from `note.ends`, which the snapshot resolved from the live rectangles of the
 * objects the ends name - so this component never asks where anything is, and an arrow redraws
 * itself when anyone, anywhere, moves what it points at. An end whose object is gone renders at the
 * point it was last seen, which is what a concurrent delete leaves behind.
 *
 * Its hit area is the line, not its box: a transparent stroke as wide on screen as the click
 * tolerance (converted from screen pixels at the current zoom, so an arrow is no easier to catch
 * when the board is zoomed out). Everything else about the arrow - the empty corner of a long
 * diagonal, in particular - lets the pointer through to the board, because an arrow's bounding box
 * is mostly not an arrow.
 */
import {
  memo,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  objectBounds,
  setConnectorEndpoint,
  snapshot,
  type ConnectorSnapshot,
} from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
} from '../../shared/config';
import { hitConnector } from '../../shared/geometry/connector-geometry';
import { useBoardCamera } from '../canvas/CameraProvider';
import type { ObjectProps } from './ObjectProps';

export interface ConnectorObjectProps extends ObjectProps {
  note: ConnectorSnapshot;
}

/** The world point a pointer event is over. */
function worldPoint(
  camera: { x: number; y: number; zoom: number },
  e: { clientX: number; clientY: number },
): Point {
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  return { x: e.clientX / zoom + camera.x, y: e.clientY / zoom + camera.y };
}

/** The three points of the arrowhead at `to`, pointing the way the line runs. */
function arrowHead(from: Point, to: Point, size: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return `${to.x},${to.y} ${to.x},${to.y} ${to.x},${to.y}`;
  const ux = dx / length;
  const uy = dy / length;
  // the two back corners: back along the line, and out to either side of it
  const back = { x: to.x - ux * size, y: to.y - uy * size };
  const half = size * 0.4;
  return [
    `${to.x},${to.y}`,
    `${back.x - uy * half},${back.y + ux * half}`,
    `${back.x + uy * half},${back.y - ux * half}`,
  ].join(' ');
}

function ConnectorObjectBase({
  note,
  doc,
  zoom,
  selected,
  canEdit = true,
  onObjectPointerDown,
  undo,
}: ConnectorObjectProps): JSX.Element {
  const { getCamera } = useBoardCamera();
  // A dragged end handle: which end, and where on the board the pointer has got to. Nothing is
  // written until the pointer comes up, so a cancelled drag leaves the arrow exactly as it was.
  const [drag, setDrag] = useState<{ end: 'from' | 'to'; point: Point } | null>(null);

  const ends = note.ends;
  const shown = drag
    ? {
        from: drag.end === 'from' ? drag.point : ends.from,
        to: drag.end === 'to' ? drag.point : ends.to,
      }
    : ends;

  // The drawing covers the line plus room for the arrowhead and the stroke, so nothing is clipped.
  const pad = CONNECTOR_STROKE_WIDTH_WORLD + CONNECTOR_ARROWHEAD_SIZE_WORLD * 2;
  const left = Math.min(shown.from.x, shown.to.x) - pad;
  const top = Math.min(shown.from.y, shown.to.y) - pad;
  const width = Math.abs(shown.to.x - shown.from.x) + pad * 2;
  const height = Math.abs(shown.to.y - shown.from.y) + pad * 2;
  // as wide on screen as the tolerance, whatever the zoom
  const hitWidth = (CONNECTOR_HIT_TOLERANCE_PX * 2) / (zoom > 0 ? zoom : 1);
  const handleRadius = CONNECTOR_DOT_RADIUS_PX / (zoom > 0 ? zoom : 1);

  /** The topmost object at a world point, ignoring arrows: an arrow does not take an arrow. */
  const topmostAt = (world: Point): string | null => {
    const objects = snapshot(doc);
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      const obj = objects[i]!;
      if (obj.type === 'connector' || obj.id === note.id) continue;
      const box = objectBounds(obj);
      if (
        world.x >= box.x &&
        world.x <= box.x + box.width &&
        world.y >= box.y &&
        world.y <= box.y + box.height
      ) {
        return obj.id;
      }
    }
    return null;
  };

  const beginHandleDrag = (end: 'from' | 'to') => (event: ReactPointerEvent<SVGCircleElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    if (!canEdit) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ end, point: worldPoint(getCamera(), event) });
  };

  const moveHandleDrag = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!drag) return;
    event.stopPropagation();
    setDrag({ end: drag.end, point: worldPoint(getCamera(), event) });
  };

  const endHandleDrag = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!drag) return;
    event.stopPropagation();
    const point = worldPoint(getCamera(), event);
    const current = drag;
    setDrag(null);

    const other = current.end === 'from' ? note.to : note.from;
    const target = topmostAt(point);
    // Dropping an end on the object the other end is already attached to would make an arrow out of
    // nothing. The handle snaps back, which is the model refusing and the picture agreeing with it.
    if (target !== null && other.kind === 'attached' && other.objectId === target) return;

    const next =
      target !== null
        ? ({ kind: 'attached', objectId: target, fallback: point } as const)
        : ({ kind: 'free', x: point.x, y: point.y } as const);

    // one re-attach is one step of history
    undo?.boundary();
    setConnectorEndpoint(doc, note.id, current.end, next);
    undo?.boundary();
  };

  const style = { left, top, width, height, zIndex: note.z } as CSSProperties;

  return (
    <div
      className="connector-object"
      data-board-object
      data-connector-object
      data-connector-id={note.id}
      data-selected={selected ? 'true' : undefined}
      data-connector-from={note.from.kind === 'attached' ? note.from.objectId : 'free'}
      data-connector-to={note.to.kind === 'attached' ? note.to.objectId : 'free'}
      data-testid="connector-object"
      style={style}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        // Only the line answers. A click inside the box of a diagonal arrow, where there is no
        // arrow, belongs to the board.
        const world = worldPoint(getCamera(), event);
        if (!hitConnector(shown, world, getCamera().zoom)) return;
        event.stopPropagation();
        // The generic gesture from here: it does the selecting, the shift-toggle and the drag - and
        // dragging an arrow writes nothing, because an arrow has no position of its own (story 10).
        onObjectPointerDown(event, note.id);
      }}
    >
      <svg
        className="connector-object__svg"
        width={width}
        height={height}
        viewBox={`${left} ${top} ${width} ${height}`}
        role="group"
        aria-label="Connector"
        focusable="false"
      >
        {/* The target a click is measured against: as wide on screen as the tolerance, and
            invisible. The handler below measures the same distance exactly, at the live zoom. */}
        <line
          className="connector-object__hit"
          data-testid="connector-hit"
          x1={shown.from.x}
          y1={shown.from.y}
          x2={shown.to.x}
          y2={shown.to.y}
          strokeWidth={hitWidth}
        />
        <line
          className="connector-object__line"
          data-testid="connector-line"
          x1={shown.from.x}
          y1={shown.from.y}
          x2={shown.to.x}
          y2={shown.to.y}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        />
        <polygon
          className="connector-object__head"
          data-testid="connector-head"
          points={arrowHead(shown.from, shown.to, CONNECTOR_ARROWHEAD_SIZE_WORLD)}
        />
        {selected
          ? (['from', 'to'] as const).map((end) => (
              <circle
                key={end}
                className="connector-object__handle"
                data-connector-handle={end}
                data-testid="connector-handle"
                cx={shown[end].x}
                cy={shown[end].y}
                r={handleRadius}
                onPointerDown={beginHandleDrag(end)}
                onPointerMove={moveHandleDrag}
                onPointerUp={endHandleDrag}
                onPointerCancel={() => {
                  setDrag(null);
                }}
              />
            ))
          : null}
      </svg>
    </div>
  );
}

/**
 * Memoised like the other object components: a new snapshot replaces `note`, so an arrow re-renders
 * when anything it depends on moves - which, an arrow depending on two other objects, is often.
 */
export const ConnectorObject = memo(ConnectorObjectBase);
