import {
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import { createConnector, CONNECTOR_TYPE } from '../../shared/objects/connector';
import type { EndpointInput } from '../../shared/objects/connector';
import { SIDES, nearestSide, sideAnchor } from '../../shared/geometry/connector-geometry';
import type { Side } from '../../shared/geometry/connector-geometry';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import { useUndoController } from '../board/useUndo';

/**
 * The Connector tool's surface (`connector.ui`): the layer over the board while the Connector
 * tool is up. It shows where an arrow would join the object under the pointer, draws the arrow
 * being dragged, and puts one arrow down when the pointer is released.
 *
 * The dots are the whole point of it (PRD: "Connection points are shown"): four of them, at
 * the midpoints of the sides of whatever the pointer is over, which is also the honest answer
 * to "where will this arrow join?" — the side an arrow picks is the one nearest the other end,
 * so while a drag is going on the target object's four dots stay up and the one the arrow will
 * actually use is marked. Everything the tool draws is derived from the snapshot, so the dots
 * sit where the object will be drawn even in the moment after somebody else moved it.
 *
 * Like the Shape tool, this layer takes every press in the viewport, so nothing under the
 * pointer starts a move of its own. An arrow that the model refuses — both ends on one object,
 * or a drag too short to be an arrow — leaves the board alone and the tool up (PRD: "No
 * accidental arrows").
 */
export interface ConnectorToolProps {
  camera: Camera;
  /** Every object on the board, for finding which one the pointer is over. */
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  createdBy: string;
  /** The arrow is on the board: it becomes the selection and the tool goes back to Select. */
  onCreated(id: string): void;
}

/** A drag in progress, in screen pixels. */
interface Drag {
  readonly fromScreen: Point;
  toScreen: Point;
  /** The object the drag started on, or null when it started on empty board. */
  readonly fromObject: string | null;
  /** The object the pointer is over now, which is the end that may still attach. */
  readonly overObject: string | null;
}

export function ConnectorTool({
  camera,
  snapshot,
  doc,
  createdBy,
  onCreated,
}: ConnectorToolProps): JSX.Element {
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const pointerIdRef = useRef<number | null>(null);
  const undo = useUndoController();

  /** Which object this pointer, in screen pixels, is over — the registry's own hit test. */
  const objectAt = (screen: Point): ObjectSnapshot | null => {
    const cam = cameraRef.current;
    const world = screenToWorld(cam, screen);
    // Last drawn wins, which is the top of the stack: read them backwards.
    const objects = snapshotRef.current;
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      const object = objects[index];
      // An arrow is not a target: its box is its two ends, so it is a box mostly full of
      // empty board, and an end attached to an arrow would have no side to sit on.
      if (object.type === CONNECTOR_TYPE) continue;
      const spec = getObjectType(object.type);
      if (!spec) continue;
      if (spec.hitTest(object, world, cam.zoom)) return object;
    }
    return null;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const screen = screenPoint(event);
    if (pointerIdRef.current === event.pointerId) {
      event.stopPropagation();
      setDrag((current) =>
        current ? { ...current, toScreen: screen, overObject: objectAt(screen)?.id ?? null } : current,
      );
      return;
    }
    // Not dragging: this is a hover, and it decides which object gets dots.
    setHover(objectAt(screen)?.id ?? null);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    event.stopPropagation();
    if (pointerIdRef.current !== null) return;
    pointerIdRef.current = event.pointerId;
    const element = event.currentTarget;
    if (typeof element.setPointerCapture === 'function') {
      element.setPointerCapture(event.pointerId);
    }
    const screen = screenPoint(event);
    const over = objectAt(screen);
    setHover(over?.id ?? null);
    setDrag({ fromScreen: screen, toScreen: screen, fromObject: over?.id ?? null, overObject: over?.id ?? null });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    event.stopPropagation();
    const current = drag;
    setDrag(null);
    if (!current) return;
    const cam = cameraRef.current;
    const screen = screenPoint(event);
    const start = screenToWorld(cam, current.fromScreen);
    const finish = screenToWorld(cam, screen);
    // The object the pointer came to rest on, asked again now: the snapshot it answered from
    // is the current one, so a target somebody else deleted a moment ago is not attached to.
    const over = objectAt(screen);
    const from: EndpointInput = current.fromObject
      ? { kind: 'attached', objectId: current.fromObject, fallback: start }
      : { kind: 'free', x: start.x, y: start.y };
    const to: EndpointInput = over ? { kind: 'attached', objectId: over.id, fallback: finish } : {
      kind: 'free',
      x: finish.x,
      y: finish.y,
    };
    // One arrow is one undo step, including the one that is refused (TC-19, PRD's own errors).
    undo?.boundary();
    const id = createConnector(doc, from, to, createdBy);
    undo?.boundary();
    if (id === null) return;
    onCreatedRef.current(id);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    event.stopPropagation();
    // Thrown away: no arrow, and the tool is still up (design: pointercancel).
    setDrag(null);
  };

  const cam = cameraRef.current;
  // The object the dots are for: what is being dragged over while a drag is going on, and
  // what the pointer is resting on otherwise.
  const dotted = drag ? drag.overObject : hover;
  const dottedObject = dotted ? (snapshot.find((object) => object.id === dotted) ?? null) : null;
  const highlight: Side | null =
    drag && dottedObject ? nearestSide(objectBounds(dottedObject), screenToWorld(cam, drag.fromScreen)) : null;

  return (
    <div
      className="vidi6-connector-tool-surface"
      data-testid="connector-tool-surface"
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={stop}
    >
      {dottedObject
        ? SIDES.map((side) => {
            const anchor = sideAnchor(objectBounds(dottedObject), side);
            const screen = worldToScreen(cam, anchor);
            const isHighlighted = highlight === side;
            return (
              <div
                key={side}
                className="vidi6-connector-dot"
                data-testid="connector-dot"
                data-connector-side={side}
                data-connector-object={dottedObject.id}
                data-highlighted={isHighlighted ? 'true' : 'false'}
                style={{
                  position: 'absolute',
                  left: `${screen.x - CONNECTOR_DOT_RADIUS_PX}px`,
                  top: `${screen.y - CONNECTOR_DOT_RADIUS_PX}px`,
                  width: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
                  height: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
                }}
              />
            );
          })
        : null}
      {drag ? (
        <svg
          className="vidi6-connector-preview"
          data-testid="connector-preview"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          <line
            x1={drag.fromScreen.x}
            y1={drag.fromScreen.y}
            x2={drag.toScreen.x}
            y2={drag.toScreen.y}
            className="vidi6-connector-preview-line"
          />
        </svg>
      ) : null}
    </div>
  );
}

function stop(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}

function screenPoint(event: {
  currentTarget: EventTarget | null;
  clientX: number;
  clientY: number;
}): Point {
  const element = event.currentTarget as HTMLElement;
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
