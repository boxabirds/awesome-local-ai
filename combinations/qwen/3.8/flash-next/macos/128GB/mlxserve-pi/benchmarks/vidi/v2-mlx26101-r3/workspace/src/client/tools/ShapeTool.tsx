import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { ShapeKind } from '../../shared/config';
import { createShape } from '../../shared/objects/shape';
import type { Rect } from '../../shared/geometry';
import { worldToScreen, type Camera, type Point } from '../canvas/camera';
import { useBoard } from '../board/BoardContext';
import {
  isBoardUi,
  isClick,
  isPrimaryButton,
  onDragEnds,
  rectBetween,
  squareBox,
  worldPoint,
} from './boardPointer';

export interface ShapeToolProps {
  /** Rectangle, ellipse or diamond: the Shape menu's choice, which the tool does not decide. */
  kind: ShapeKind;
  /** The camera, to turn the drag's screen points into board units. */
  camera: Camera;
  /** A shape was made: the board selects it and puts the Select tool back up. */
  onCreated(id: string): void;
}

/** The box of a shape being dragged, in board units: `null` for a press that has not travelled. */
type DragBox = Rect | null;

/**
 * The Shape tool: press, drag, let go, and there is a shape.
 *
 * Two things about this component are worth the saying, because neither is obvious from the shape of
 * it.
 *
 * The first is that it takes the pointer in the *capture* phase, on the window, before the board
 * viewport and before any object under the cursor. That is the only way a drag that starts on top of
 * a sticky note draws a shape instead of moving the note: a handler on the tool's own element would
 * never hear that press, because the note would answer it first. The board's pan, its marquee and
 * its double-click-to-make-a-note are all swallowed by the same `stopPropagation`, for the same
 * reason - a press that is about to become a shape is not a press that is about to become anything
 * else. (Story 9's Text tool does exactly this from inside the viewport; a tool that lives outside
 * the viewport has to reach one level higher to do it.)
 *
 * The second is that nothing is written until the pointer is let go. Sixty moves would be sixty
 * writes and sixty undo steps; the dashed box is the record of the drag while it happens, and the
 * one `createShape` call at the end is the one thing the document ever hears. That is also why
 * Escape needs no special handling here: putting the Select tool back unmounts this component, and
 * the cleanup of the effect that installed these listeners drops the drag in progress without
 * writing it.
 */
export function ShapeTool({ kind, camera, onCreated }: ShapeToolProps): JSX.Element {
  const services = useBoard();
  // The preview is kept in screen units, because that is the space it is painted in. The drag's own
  // arithmetic is done in board units, because that is the space the shape is written in; the two are
  // projected into each other at the two ends of the trip and nowhere in between.
  const [preview, setPreview] = useState<Rect | null>(null);

  const dragRef = useRef<{ down: Point; world: Point; square: boolean; pointerId: number } | null>(
    null,
  );
  // The camera changes underneath these listeners - a drag that outlives a wheel event happens - so
  // the world position of a pointer is computed from the camera of the moment, not of the moment the
  // press went down.
  const cameraRef = useRef(camera);
  // The same story for the two props that decide what gets written: the kind is the Shape menu's
  // state and the callback belongs to the board. Neither is a reason to reinstall listeners in the
  // middle of a drag, which would be a way to lose the drag.
  const propsRef = useRef({ kind, onCreated });
  const servicesRef = useRef(services);
  useEffect(() => {
    cameraRef.current = camera;
    propsRef.current = { kind, onCreated };
    servicesRef.current = services;
  });

  useEffect(() => {
    let stopListening: (() => void) | null = null;

    /** The box of the drag so far, in board units, Shift's square included. */
    const dragBox = (event: PointerEvent | null, drag: { world: Point; square: boolean }): DragBox => {
      if (event === null) {
        return null;
      }
      const box = rectBetween(drag.world, worldPoint(cameraRef.current, event));
      // Shift is read on every move rather than remembered from the press, because the person can put
      // it down or pick it up in the middle of a drag, and the box should follow what the key is doing
      // now rather than what it was doing at the start.
      return drag.square ? squareBox(box, drag.world) : box;
    };

    const show = (event: PointerEvent, box: DragBox): void => {
      const cameraNow = cameraRef.current;
      setPreview(
        box === null
          ? { x: event.clientX, y: event.clientY, width: 0, height: 0 }
          : {
              x: worldToScreen(cameraNow, { x: box.x, y: box.y }).x,
              y: worldToScreen(cameraNow, { x: box.x, y: box.y }).y,
              width: box.width * cameraNow.zoom,
              height: box.height * cameraNow.zoom,
            },
      );
    };

    const finish = (event: PointerEvent): void => {
      const drag = dragRef.current;
      dragRef.current = null;
      stopListening?.();
      stopListening = null;
      setPreview(null);
      if (drag === null || event.pointerId !== drag.pointerId) {
        return;
      }
      const board = servicesRef.current;
      if (board === null || !board.canEdit) {
        // A board that cannot be written to writes nothing, and does not complain about it: the
        // button that arms this tool is disabled on such a board, so the only way to be here is a
        // board that stopped being writable while the pointer was down.
        return;
      }
      // A press that never travelled is a click, and a click is not a very small shape: it is the
      // standard one. A press that travelled a little is the same answer, which the model gives
      // itself - it is the model that decides where the line between a drag and a click falls, so
      // the tool does not draw it a second time in board units.
      const clicked = isClick(drag.down, { x: event.clientX, y: event.clientY });
      const rect = clicked ? null : dragBox(event, drag);
      board.undo?.boundary();
      const id = createShape(
        board.doc,
        {
          kind: propsRef.current.kind,
          rect,
          at: drag.world,
          // The model is told Shift was held rather than being handed an already-square box: which
          // corner a square is held by is a question about the drag, and the rule about it lives in
          // the model, where the tests are.
          square: drag.square,
        },
        String(board.doc.clientID),
      );
      board.undo?.boundary();
      if (id !== null) {
        propsRef.current.onCreated(id);
      }
      // A shape the model refused leaves the tool exactly where it was, which is what "a rejection
      // leaves the tool active" asks for. No else branch is needed: this function does not touch the
      // tool either way, and the board that gets the good news is the one that puts Select back up.
    };

    const move = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (drag === null || event.pointerId !== drag.pointerId) {
        return;
      }
      drag.square = event.shiftKey;
      show(event, dragBox(event, drag));
    };

    const down = (event: PointerEvent): void => {
      if (isBoardUi(event.target) || !isPrimaryButton(event) || dragRef.current !== null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = {
        down: { x: event.clientX, y: event.clientY },
        world: worldPoint(cameraRef.current, event),
        square: event.shiftKey,
        pointerId: event.pointerId,
      };
      stopListening = onDragEnds(move, finish);
      show(event, null);
    };

    const swallowDoubleClick = (event: MouseEvent): void => {
      // A double-click is not a way to make a sticky note underneath the shape being drawn. Both
      // halves of the press were swallowed already, but `dblclick` is its own event and would still
      // reach the board.
      if (isBoardUi(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('pointerdown', down, true);
    window.addEventListener('dblclick', swallowDoubleClick, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('dblclick', swallowDoubleClick, true);
      // An unfinished drag is dropped, and dropped silently: Escape is pressed with the intention of
      // not making that shape, and the shape is not made.
      stopListening?.();
      stopListening = null;
      dragRef.current = null;
      setPreview(null);
    };
  }, []);

  if (preview === null) {
    // No drag, no overlay. An element stretched across the board that answers no events is still an
    // element in the way of whatever the next person tries to click.
    return <></>;
  }
  return (
    <svg
      className="tool-preview"
      data-testid="shape-preview"
      data-kind={kind}
      aria-hidden="true"
    >
      <rect
        className="tool-preview__shape"
        data-testid="shape-preview-rect"
        x={preview.x}
        y={preview.y}
        width={preview.width}
        height={preview.height}
      />
    </svg>
  );
}
