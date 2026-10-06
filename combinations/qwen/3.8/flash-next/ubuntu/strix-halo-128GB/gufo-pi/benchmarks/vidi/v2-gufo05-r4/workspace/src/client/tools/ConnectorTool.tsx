/**
 * The Connector tool: the surface that turns a drag from one thing into an arrow to another
 * (`connector.ui`).
 *
 * It is an overlay, like the Shape tool, for the same reason: while it is held the pointer
 * belongs to it, and every point on the board is a place to start or finish an arrow —
 * including a point on top of an object (`tools.paint_overlay`). The overlay is also where the
 * *possibilities* are drawn. The objects under it are switched off to the pointer by the
 * stylesheet, so the tool finds what the pointer is over itself, by asking where things are
 * (`snapshot` rects) rather than waiting to be told a pointer arrived at one.
 *
 * The states are the design's:
 *
 *  - **Hovering.** The pointer is over a board object, so its four side midpoints appear as
 *    dots (`connector.hover_points`) — the places an arrow can leave from.
 *  - **Dragging.** The preview follows the pointer and the dot it would attach to — the side
 *    nearest the other end — is highlighted, which is the same rule the model uses when it
 *    stores the arrow, so the highlight and the arrow cannot disagree.
 *  - **Release.** Over another object, both ends are attached. Over empty board, the end is
 *    free at that point. A release over the object the drag started on, or one shorter than
 *    `CONNECTOR_MIN_LENGTH_WORLD`, creates nothing and the tool stays held: an arrow from a
 *    shape to itself, or a click that wobbled, is not a thing anyone meant to draw
 *    (`connector.no_accidental`).
 *  - **Created.** The arrow becomes the selection and the tool goes back to Select, so it can
 *    be moved or re-aimed at once (`tools.return_to_select`).
 */

import { useCallback, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type { Doc } from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { CONNECTOR_ARROWHEAD_SIZE_WORLD, CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { arrowheadPath, nearestSide, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import { createConnector, type ConnectorEndpointInput } from '../../shared/objects/connector';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { attachTargetAt, isAttachTarget } from '../objects/attachTargets';
import { useUndoController } from '../board/useUndo';

export interface ConnectorToolProps {
  doc: Doc;
  camera: Camera;
  /** Every object on the board: the ones an arrow may start from or point at, and their boxes. */
  snapshot: readonly ObjectSnapshot[];
  /** False while the board cannot be written to (story 4). */
  canEdit?: boolean;
  /** The arrow was made: select it and put the pointer back to Select. */
  onCreated(id: string): void;
}

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** A drag in progress, in board units, with what the pointer is currently over. */
interface Drag {
  /** Where the tail is: the object the pointer went down on, or the point it went down at. */
  start: ConnectorEndpointInput;
  from: Point;
  to: Point;
  /** The object the pointer is over now, if any. */
  target: string | null;
}

/** A dot: which object's side, where on the screen, and whether the arrow would use it. */
interface Dot {
  objectId: string;
  side: Side;
  screen: Point;
  highlighted: boolean;
}

export function ConnectorTool(props: ConnectorToolProps): JSX.Element {
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const cameraRef = useRef(props.camera);
  cameraRef.current = props.camera;
  const docRef = useRef(props.doc);
  docRef.current = props.doc;
  const canEditRef = useRef(props.canEdit !== false);
  canEditRef.current = props.canEdit !== false;
  const onCreatedRef = useRef(props.onCreated);
  onCreatedRef.current = props.onCreated;

  const undoController = useUndoController();
  const undoRef = useRef(undoController);
  undoRef.current = undoController;

  /**
   * The boxes an arrow could be tied to, topmost last.
   *
   * Read from the snapshot rather than the document, so the dots are drawn against the same
   * positions the screen is showing: a person who moves a shape sees the dot they are aiming at
   * move with it (`connector.follow`).
   */
  const targets = props.snapshot
    .filter(isAttachTarget)
    .map((object) => ({ id: object.id, rect: objectBounds(object) }));

  /**
   * What the pointer is over: the topmost object containing that board point. Asked of the
   * snapshot, which is rebuilt every render — so it must never be remembered across a move of
   * the thing it describes, and the dot a person is aiming at moves with the shape.
   */
  const targetAt = useCallback(
    (world: Point): string | null => attachTargetAt(props.snapshot, world)?.id ?? null,
    [props.snapshot]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !canEditRef.current) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.stopPropagation();
      const world = screenToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });
      const over = targetAt(world);
      setDrag({
        // An arrow that starts on empty board starts *there*, and stays there when the shapes
        // around it move (`connector.create_free`).
        start: over ? { kind: 'attached', objectId: over } : { kind: 'free', x: world.x, y: world.y },
        from: world,
        to: world,
        target: over
      });
    },
    [targetAt]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const world = screenToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });
      const over = targetAt(world);
      setDrag((current) => (current ? { ...current, to: world, target: over } : current));
      setHover(over);
    },
    [targetAt]
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = dragRef.current;
      dragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setDrag(null);
      if (!current || !canEditRef.current) return;

      const to: ConnectorEndpointInput = current.target
        ? { kind: 'attached', objectId: current.target }
        : { kind: 'free', x: current.to.x, y: current.to.y };
      // One undo step for the arrow, bounded on both sides, so the arrow and whatever it
      // re-attaches to later are separate steps (`undo.steps`).
      undoRef.current?.boundary();
      const id = createConnector(docRef.current, { from: current.start, to }, '');
      undoRef.current?.boundary();
      // Rejected — the same object at both ends, too short, or an object that went away in the
      // moment the pointer was down — creates nothing and leaves the tool held.
      if (id) onCreatedRef.current(id);
    },
    []
  );

  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const cancel = useCallback(() => {
    dragRef.current = null;
    setDrag(null);
  }, []);

  // The dots are drawn for the object the pointer is over: while dragging that is wherever the
  // head is, and the one the arrow would use is highlighted.
  const focus = drag ? drag.target : hover;
  const focusRect = targets.find((target) => target.id === focus)?.rect;
  const dots: Dot[] = [];
  if (focus && focusRect) {
    // Not dragging: the four side midpoints appear as the possibilities they are. Dragging: the
    // same four, with the side nearest the tail marked, because that is the side the arrow will
    // leave from once it is stored — the same `nearestSide` the model applies, so the highlight
    // and the arrow cannot disagree (TC-19).
    const aim = drag ? nearestSide(focusRect, drag.from) : null;
    for (const side of SIDES) {
      dots.push({
        objectId: focus,
        side,
        screen: worldToScreen(cameraRef.current, sideAnchor(focusRect, side)),
        highlighted: aim !== null && side === aim
      });
    }
  }

  const startScreen = drag ? worldToScreen(cameraRef.current, drag.from) : null;
  const toScreen = drag ? worldToScreen(cameraRef.current, drag.to) : null;

  return (
    <div
      className="vidi6-connector-tool"
      data-vidi6="connector-tool"
      data-dragging={drag ? 'true' : 'false'}
      data-hover={focus ?? ''}
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={cancel}
    >
      {dots.length > 0 ? (
        <svg className="vidi6-connector-dots" data-testid="connector-dots" width="100%" height="100%">
          {dots.map((dot) => (
            <circle
              key={`${dot.objectId}-${dot.side}`}
              className="vidi6-connector-dot"
              data-vidi6="connector-dot"
              data-object-id={dot.objectId}
              data-side={dot.side}
              data-highlighted={dot.highlighted ? 'true' : 'false'}
              cx={dot.screen.x}
              cy={dot.screen.y}
              r={CONNECTOR_DOT_RADIUS_PX}
            />
          ))}
        </svg>
      ) : null}

      {drag && startScreen && toScreen ? (
        <svg className="vidi6-connector-preview" data-testid="connector-preview" width="100%" height="100%">
          <path data-role="line" d={`M ${startScreen.x} ${startScreen.y} L ${toScreen.x} ${toScreen.y}`} />
          {/* The head is a board measurement, so it is drawn at its screen size: same rule as
              the stroke, and the same shape the arrow will have once it is stored. */}
          <path
            data-role="head"
            d={arrowheadPath(startScreen, toScreen, CONNECTOR_ARROWHEAD_SIZE_WORLD * (cameraRef.current.zoom || 1))}
          />
        </svg>
      ) : null}
    </div>
  );
}
