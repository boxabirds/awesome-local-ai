import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import { createConnector } from '../../shared/objects/connector';
import {
  endpointAim,
  endpointPoint,
  nearestSide,
  SIDES,
  sideAnchor,
  type Endpoint,
} from '../../shared/geometry/connector-geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { useBoard } from '../board/BoardContext';
import { endpointAt, attachTargetAt, rectsOf } from '../objects/connectorTarget';
import { isBoardUi, isPrimaryButton, onDragEnds, worldPoint } from './boardPointer';

export interface ConnectorToolProps {
  camera: Camera;
  /** Everything on the board, which is what an arrow can be drawn to. */
  snapshot: readonly ObjectSnapshot[];
  /** An arrow was made: the board selects it and puts the Select tool back up. */
  onCreated(id: string): void;
}

/** A drag in progress: where the arrow starts, where the pointer is, and which pointer it is. */
interface Drag {
  from: Endpoint;
  to: Endpoint;
  pointer: Point;
  pointerId: number;
}

/** A point of the screen, which is the only space a dot can be drawn in. */
interface Dot extends Point {
  target: boolean;
}

/**
 * The Connector tool: point at a thing, pull, and let go on another thing.
 *
 * The four dots are the whole of the invitation. An arrow that can be drawn from anywhere on a shape
 * to anywhere on another is an arrow whose attachment nobody can predict, and the dots say, in the
 * one language a pointer understands, "this shape will hold an arrow, at any of these four places".
 * They appear under the pointer when it is over a thing that can be attached to and nowhere else,
 * because dots drawn on empty board would be dots about nothing.
 *
 * The dot that will be used is lit while the drag is out there looking for a second thing. Which side
 * a shape presents is not a question the shape answers on its own - it is answered by where the arrow
 * is going - so the highlighted dot is the answer to the same question the model will answer when it
 * writes the arrow down, computed by the same two functions. That is not a shortcut for the sake of
 * it: a preview that lights one dot and an arrow that comes out of another would teach people that
 * the dots mean something other than what they mean.
 *
 * Nothing is written until the pointer is let go, and nothing is written when the model says no - a
 * drag that came back to the shape it left, or one that went nowhere worth an arrow, leaves the tool
 * armed and the board unchanged, which is the board telling the person to draw the arrow they meant.
 */
export function ConnectorTool({ camera, snapshot, onCreated }: ConnectorToolProps): JSX.Element {
  const services = useBoard();
  const [drag, setDrag] = useState<Drag | null>(null);
  // The object whose dots are showing. A name rather than a box, so that a move of the object under
  // the pointer puts the dots where the object has gone rather than where it was.
  const [hoverId, setHoverId] = useState<string | null>(null);

  const stateRef = useRef({ camera, snapshot, onCreated, services });
  useEffect(() => {
    stateRef.current = { camera, snapshot, onCreated, services };
  });
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    let stopListening: (() => void) | null = null;

    const look = (event: PointerEvent, current: Drag | null): void => {
      const world = worldPoint(stateRef.current.camera, event);
      const target = attachTargetAt(stateRef.current.snapshot, world);
      // The shape the arrow already left does not offer its dots: fastening both ends of one arrow to
      // one shape is refused by the model, so showing its dots would be an offer this tool has no
      // intention of honouring.
      const showing =
        current !== null && target !== null && isEndOf(current.from, target.id)
          ? null
          : (target?.id ?? null);
      setHoverId(showing);
      if (current === null) {
        return;
      }
      const to = endpointAt(stateRef.current.snapshot, world);
      const next = { ...current, to, pointer: world };
      dragRef.current = next;
      setDrag(next);
    };

    const finish = (event: PointerEvent): void => {
      const current = dragRef.current;
      dragRef.current = null;
      stopListening?.();
      stopListening = null;
      setDrag(null);
      setHoverId(null);
      if (current === null || event.pointerId !== current.pointerId) {
        // The pointer that let go is not the pointer that went down: this drag is somebody else's.
        return;
      }
      const board = stateRef.current.services;
      if (board === null || !board.canEdit) {
        return;
      }
      const world = worldPoint(stateRef.current.camera, event);
      const to = endpointAt(stateRef.current.snapshot, world);
      board.undo?.boundary();
      const id = createConnector(board.doc, current.from, to, String(board.doc.clientID));
      board.undo?.boundary();
      if (id !== null) {
        stateRef.current.onCreated(id);
      }
    };

    const move = (event: PointerEvent): void => {
      look(event, dragRef.current);
    };

    const down = (event: PointerEvent): void => {
      if (isBoardUi(event.target) || !isPrimaryButton(event) || dragRef.current !== null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const world = worldPoint(stateRef.current.camera, event);
      const from = endpointAt(stateRef.current.snapshot, world);
      const current: Drag = { from, to: from, pointer: world, pointerId: event.pointerId };
      dragRef.current = current;
      stopListening = onDragEnds(move, finish);
      look(event, current);
    };

    const hover = (event: PointerEvent): void => {
      // Not dragging: the dots follow the pointer. While a drag is on, its own move handler is the
      // one that decides what is showing, and this would only say the same thing a moment later.
      if (dragRef.current !== null) {
        return;
      }
      look(event, null);
    };

    const swallowDoubleClick = (event: MouseEvent): void => {
      if (isBoardUi(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    const leave = (): void => {
      setHoverId(null);
    };

    window.addEventListener('pointerdown', down, true);
    // The hover is listened for in the capture phase, before anything on the board: the dots are
    // meant to appear over the objects themselves, and a component that stopped a move event from
    // travelling any further would otherwise be a component whose shapes had no dots on them.
    window.addEventListener('pointermove', hover, true);
    window.addEventListener('dblclick', swallowDoubleClick, true);
    window.addEventListener('pointerleave', leave);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', hover, true);
      window.removeEventListener('dblclick', swallowDoubleClick, true);
      window.removeEventListener('pointerleave', leave);
      stopListening?.();
      stopListening = null;
      dragRef.current = null;
      setDrag(null);
      setHoverId(null);
    };
  }, []);

  const board = services;
  const rects = rectsOf(snapshot);
  const hover = hoverId === null ? null : snapshot.find((object) => object.id === hoverId);
  const dots = dotsOf(hover ?? null, drag, rects, camera);
  const line = drag === null ? null : previewLine(drag, rects, camera);

  if (dots.length === 0 && line === null) {
    // Nothing to say, nothing drawn: an overlay stretched across the board is not harmless just
    // because it is transparent, and this one has its pointer events switched off for a reason.
    return <></>;
  }
  if (board === null) {
    return <></>;
  }

  return (
    <svg
      className="tool-preview"
      data-testid="connector-preview"
      data-hover={hover?.id ?? ''}
      data-dragging={drag === null ? 'false' : 'true'}
      aria-hidden="true"
    >
      {line === null ? null : (
        <line
          className="tool-preview__line"
          data-testid="connector-preview-line"
          x1={line.from.x}
          y1={line.from.y}
          x2={line.to.x}
          y2={line.to.y}
        />
      )}
      {dots.map((dot, index) => (
        <circle
          key={`${Math.round(dot.x)}:${Math.round(dot.y)}:${index}`}
          className={dot.target ? 'connector-tool__dot connector-tool__dot--target' : 'connector-tool__dot'}
          data-testid={dot.target ? 'connector-target-dot' : 'connector-dot'}
          cx={dot.x}
          cy={dot.y}
          r={CONNECTOR_DOT_RADIUS_PX}
        />
      ))}
    </svg>
  );
}

/** Does this end name that object? */
function isEndOf(end: Endpoint, id: string): boolean {
  return end.kind === 'attached' && end.objectId === id;
}

/**
 * The dots to draw for the object under the pointer: four, or four with one of them lit.
 *
 * The lit one is the side the arrow will leave or arrive at, which is decided by the *other* end - by
 * the object it is attached to when there is one, and by the point the pointer is at while there is
 * no drag yet. That is `endpointAim`, the same function `resolveEndpoints` uses to decide the side of
 * a shape it is drawing, which is the only way to be sure the dot that is lit is the dot that is used.
 */
function dotsOf(
  object: ObjectSnapshot | null,
  drag: Drag | null,
  rects: ReadonlyMap<string, Rect>,
  camera: Camera,
): Dot[] {
  if (object === null) {
    return [];
  }
  const box = rects.get(object.id);
  if (box === undefined) {
    return [];
  }
  // What the other end is aiming at. Before there is a drag there is no answer, and no dot is lit:
  // four dots say "this shape takes arrows", and which of the four it is comes later.
  const aim: Point | null = drag === null ? null : aimOf(drag, object.id, rects);
  const side = aim === null ? null : nearestSide(box, aim);
  return SIDES.map((name) => {
    const anchor = sideAnchor(box, name);
    const screen = worldToScreen(camera, anchor);
    return { x: screen.x, y: screen.y, target: side === name };
  });
}

function aimOf(drag: Drag, id: string, rects: ReadonlyMap<string, Rect>): Point {
  // The end that is not being dragged is the aim of the one that is. Whichever end belongs to the
  // object being hovered is left out of the question, because a shape does not decide which of its
  // sides to present by looking at itself.
  const other = isEndOf(drag.from, id) ? drag.to : drag.from;
  return endpointAim(other, rects);
}

/**
 * The dashed line, drawn between the two points the arrow would occupy.
 *
 * Not between the two points the pointer visited: between the two the arrow would be drawn at, which
 * on a shape are the middles of sides rather than anywhere on the surface. `endpointPoint` and
 * `resolveEndpoints` are asked the same question the renderer will ask a moment later, so the preview
 * and the thing it previews cannot disagree about where the arrow goes.
 */
function previewLine(
  drag: Drag,
  rects: ReadonlyMap<string, Rect>,
  camera: Camera,
): { from: Point; to: Point } {
  const from = endpointPoint(drag.from, rects, endpointAim(drag.to, rects));
  const to = endpointPoint(drag.to, rects, endpointAim(drag.from, rects));
  return { from: worldToScreen(camera, from), to: worldToScreen(camera, to) };
}
