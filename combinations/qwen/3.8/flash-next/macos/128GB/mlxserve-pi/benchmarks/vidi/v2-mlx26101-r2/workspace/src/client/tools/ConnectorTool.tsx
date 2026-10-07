import { useCallback, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import * as Y from 'yjs';

import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config.js';
import { objectBounds, type ObjectSnapshot, type Point } from '../../shared/board-model.js';
import { sideMiddles, nearestSide, type Endpoint, type Side } from '../../shared/geometry/connector-geometry.js';
import { createConnector } from '../../shared/objects/connector.js';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera.js';
import type { UndoController } from '../board/undo.js';
import { objectAtPoint } from './objectAtPoint.js';

/**
 * The Connector tool (`src/client/tools/ConnectorTool.tsx`) - the mode whose whole
 * job is the gap between two things. It is a screen-space layer, like the Shape
 * tool: while it is up it owns the pointer, and what it draws is a preview, never
 * board content until the release.
 *
 * Two things it does that are worth naming, because they are the difference between
 * an arrow that is *on* the board and a line that is merely near it:
 *
 * - **the dots are the contract.** Hovering an object shows the four places an arrow
 *   can join it, which tells the person that the arrow belongs to the object and not
 *   to the pixels. During the drag the one it will use is highlighted, so a release
 *   is never a surprise.
 * - **the release asks the object, not the pointer.** Whether the far end attaches
 *   is decided by which object the pointer is over at the moment of release (the
 *   topmost one, by the same z-order the board draws in), and an end released over
 *   nothing is kept as a free point at exactly that place rather than discarded.
 */

const PRIMARY_BUTTON = 0;

/** One end of the arrow being drawn. */
interface DragEnd {
  /** The object it is attached to, or `null` for a point on the board. */
  objectId: string | null;
  /** Where it is, in board units. */
  point: Point;
}

export interface ConnectorToolProps {
  doc: Y.Doc;
  camera: Camera;
  /** The board, for the hover dots and for deciding what the ends attach to. */
  snapshot: readonly ObjectSnapshot[];
  undo?: UndoController;
  /** Whose id is written on the arrow as its creator; nobody in this build has a name. */
  identityId?: string;
  /** An arrow was drawn: select it and go back to Select. */
  onCreated(id: string): void;
}

export function ConnectorTool({
  doc,
  camera,
  snapshot,
  undo,
  identityId = '',
  onCreated,
}: ConnectorToolProps): JSX.Element {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: DragEnd; to: Point } | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ from: DragEnd; to: Point; moved: boolean } | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  /** Screen pixels relative to the board area. */
  const local = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: event.clientX, y: event.clientY };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  /** The board point under an event. */
  const world = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const point = local(event);
      return screenToWorld(cameraRef.current, point);
    },
    [local],
  );

  /** The topmost board object under an event, connectors excluded. */
  const objectUnder = useCallback(
    (event: { clientX: number; clientY: number }): ObjectSnapshot | null =>
      objectAtPoint(snapshotRef.current, world(event)),
    [world],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== PRIMARY_BUTTON) return;
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const point = world(event);
    const object = objectUnder(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // An arrow may start on an object - in which case it is attached there and
    // follows it - or on bare board, in which case the start is a point for good.
    dragRef.current = {
      from: { objectId: object?.id ?? null, point },
      to: point,
      moved: false,
    };
    setDrag(dragRef.current);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    const point = world(event);
    if (current === null) {
      setHoverId(objectUnder(event)?.id ?? null);
      return;
    }
    current.to = point;
    if (
      !current.moved &&
      (point.x - current.from.point.x) ** 2 + (point.y - current.from.point.y) ** 2 >=
        CONNECTOR_MIN_LENGTH_WORLD * CONNECTOR_MIN_LENGTH_WORLD
    ) {
      current.moved = true;
    }
    setHoverId(null);
    setDrag({ from: current.from, to: current.to });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    setHoverId(null);
    if (current === null) return;
    const to = world(event);
    // The release decides the far end: over an object it is that object, over nothing
    // it is a point on the board. The object the arrow started on is *not* filtered
    // out of that question: letting go on it asks for an arrow between one object and
    // itself, which is the model's decision to refuse (`connector.create`) - and a
    // refusal is better than the stub the tool could invent by calling the same
    // object "a point" because it was holding a list of what may not be joined.
    const target = objectAtPoint(snapshotRef.current, to);
    undo?.boundary();
    // An attached end carries the point it was drawn at as its fallback, which is
    // where the arrow is left if the object it joined is deleted later.
    const id = createConnector(
      doc,
      end(current.from.objectId, current.from.point),
      end(target === null ? null : target.id, to),
      identityId,
    );
    undo?.boundary();
    if (typeof id === 'string') onCreatedRef.current(id);
  };

  const handlePointerCancel = () => {
    dragRef.current = null;
    setDrag(null);
  };

  /**
   * The object whose dots are showing: during a drag the one the pointer is over
   * now, otherwise the one it is merely hovering. The object the arrow started on
   * shows no dots while the arrow is being drawn, because it is the one object this
   * arrow cannot join.
   */
  const shown =
    drag !== null
      ? objectAtPoint(snapshot, drag.to)
      : (snapshot.find((object) => object.id === hoverId) ?? null);
  const shownTarget = shown !== null && shown.id !== drag?.from.objectId ? shown : null;
  const highlight: Side | null =
    drag !== null && shownTarget !== null
      ? nearestSide(objectBounds(shownTarget), drag.from.point)
      : null;

  return (
    <div
      ref={surfaceRef}
      className="tool-surface"
      data-testid="connector-tool-surface"
      data-tool="connector"
      role="presentation"
      aria-label="Drawing a connector"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {shownTarget !== null
        ? sideMiddles(objectBounds(shownTarget)).map((middle) => {
            const screen = worldToScreen(camera, middle);
            return (
              <span
                key={`${shownTarget.id}:${middle.x}:${middle.y}`}
                className="connector-dot"
                data-testid="connector-dot"
                data-object={shownTarget.id}
                data-highlighted={highlight === middle.side ? 'true' : 'false'}
                style={{
                  left: `${screen.x - CONNECTOR_DOT_RADIUS_PX}px`,
                  top: `${screen.y - CONNECTOR_DOT_RADIUS_PX}px`,
                  width: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
                  height: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
                }}
              />
            );
          })
        : null}
      {drag !== null ? <ConnectorPreview camera={camera} from={drag.from.point} to={drag.to} /> : null}
    </div>
  );
}

/** The arrow being drawn, in screen pixels. */
function ConnectorPreview({ camera, from, to }: { camera: Camera; from: Point; to: Point }): JSX.Element {
  const start = worldToScreen(camera, from);
  const end = worldToScreen(camera, to);
  return (
    <svg className="connector-preview" data-testid="connector-preview" aria-hidden="true">
      <line
        data-testid="connector-preview-line"
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
      />
    </svg>
  );
}

/**
 * One end of the arrow being drawn, as the model wants it: attached to an object
 * with the drawn point kept as its fallback, or free at that point.
 */
function end(objectId: string | null, point: Point): Endpoint {
  return objectId === null
    ? { kind: 'free', x: point.x, y: point.y }
    : { kind: 'attached', objectId, fallback: { x: point.x, y: point.y } };
}

export default ConnectorTool;
