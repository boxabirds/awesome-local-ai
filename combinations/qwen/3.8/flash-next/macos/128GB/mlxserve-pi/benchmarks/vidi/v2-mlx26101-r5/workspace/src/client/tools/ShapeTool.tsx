/**
 * The Shape tool: the pointer that draws a box instead of picking one up.
 *
 * How it holds the pointer is the whole of the component, and it is the same hold story 9 built for the
 * Text tool for the same reason: the gesture has to be taken off *everything underneath it*. A press that
 * begins on a shape, a note or a piece of text with this tool lit is the beginning of a new shape, not a
 * request to move the thing that happened to be under the pointer — which is what the design calls the
 * tool owning the gesture, and what a bubble-phase handler could never arrange. So the listeners are on
 * the document, in the capture phase, and the event is stopped where it stands: the board never begins to
 * pan, the marquee never begins, the object underneath is neither selected nor dragged.
 *
 * What it hands back is a preview and a shape. The preview is drawn in screen coordinates and is the box
 * the shape will actually be — the same `shapeRect` the model applies, so what a person sees while the
 * button is down is the rectangle that will be in the document when it comes up, including the standard
 * size that a click is allowed to ask for. On the way up it writes one shape, one transaction, one step of
 * the history, and says the one sentence a creation says: `onCreated`, which selects it and puts the
 * pointer back to Select.
 *
 * Three things it does not do, each on purpose:
 * — it does not write on a rejected gesture. A kind nobody can draw, or a box made of `NaN`, leaves the
 *   tool lit and the board unchanged — an undo stack full of shapes that were never made is worse than a
 *   click that visibly did nothing;
 * — it does not survive Escape. The tool is unmounted, this component goes with it, the drag goes with the
 *   component and nothing is written. The key that ends a tool is the key that ends its unfinished drags;
 * — it does not take a person's clicks away from the board's own controls. The toolbar, a shape's palette
 *   and an open text field are all things somebody clicks while this tool is lit.
 */

import { useEffect, useRef, useState } from 'react';
import type { Doc } from 'yjs';

import { worldToScreen, type Camera, type Point } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
import { createShape, shapeRect, type ShapeKind } from '../../shared/objects/shape';
import type { UndoControls } from '../board/useUndo';

export interface ShapeToolProps {
  /** The document the shape is written into. */
  doc: Doc;
  /** Which of the three kinds a drag draws. */
  kind: ShapeKind;
  /** The camera the pointer is being read through, for the preview's position and size. */
  camera: Camera;
  /**
   * Turns a point on this screen into a point on the board.
   *
   * Given rather than derived: the board owns the element the pointer is measured against, and a tool that
   * measured it again would be a second answer to where the board starts.
   */
  toWorld(point: Point): Point;
  /** Who made it, which is this person's identity and not the shape's business. */
  by?: string;
  /** This person's undo history: one shape is one step, whatever came before it. */
  undo?: UndoControls;
  /**
   * A shape was created: select it, and go back to Select.
   *
   * Nothing is said when the model refused, which is the difference between a tool that failed and a tool
   * that was never asked to do anything in the first place.
   */
  onCreated(id: string): void;
}

/** The drag this pointer is in.
 *
 * The anchor is kept as the world point that was pressed and the travelling end as the world point the
 * pointer is over, which is the shape in the units the model wants; the box a click makes instead of a
 * drag is not decided here at all, because it is the model that knows what a shape too small to be a shape
 * is turned into (see `shapeRect`) and a preview that guessed differently would be a promise broken on the
 * release. */
interface Drag {
  pointerId: number;
  /** Where the pointer went down, which stays the anchor of the box however the pointer travels. */
  start: Point;
  /** Where the pointer is now. */
  current: Point;
  /** Shift, as the last event said it. */
  square: boolean;
}

/** Buttons, toolbars and open text fields keep their own clicks, whatever tool is lit. */
const isControl = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  target.closest('button, textarea, input, select, [role="toolbar"]') !== null;

/** The rectangle a drag has described, in the form the model takes: signed, from the point that was pressed. */
const dragged = (start: Point, current: Point): Rect => ({
  x: start.x,
  y: start.y,
  width: current.x - start.x,
  height: current.y - start.y,
});

/** The same rectangle on the screen, which is what a box drawn over the board is positioned with. */
const onScreen = (camera: Camera, box: Rect): Rect => {
  const at = worldToScreen(camera, { x: box.x, y: box.y });
  return { x: at.x, y: at.y, width: box.width * camera.zoom, height: box.height * camera.zoom };
};

export function ShapeTool(props: ShapeToolProps): React.JSX.Element | null {
  const { camera } = props;
  /** The box that is being dragged, in screen coordinates, or nothing while no pointer is down. */
  const [preview, setPreview] = useState<Rect | null>(null);
  const dragRef = useRef<Drag | null>(null);

  // Everything the listeners need arrives through refs: they are installed once, and the tool changes, the
  // camera moves and the creation happens in the middle of the gestures they are routing.
  const propsRef = useRef(props);
  propsRef.current = props;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  useEffect(() => {
    /** The box this drag would produce, in world units, or nothing while the drag is not one yet. */
    const boxOf = (drag: Drag): Rect | null =>
      shapeRect(dragged(drag.start, drag.current), drag.start, drag.square);

    const show = (drag: Drag) => {
      const box = boxOf(drag);
      setPreview(box === null ? null : onScreen(cameraRef.current, box));
    };

    const onPointerDown = (event: PointerEvent) => {
      // Only the left button: the right one opens a menu and the middle one is a scroll.
      if (event.button !== 0 || isControl(event.target)) return;
      // Taken off the board and off whatever object is underneath it, in the same breath: see the note at
      // the top of this file. `stopPropagation` and not `stopImmediatePropagation`, which is the line
      // BoardViewport draws for the same purpose and for the same reason: the event still has to reach the
      // handlers standing on the document itself, one of which is an open text editor's, which commits what
      // was typed on a press outside the object it was typed into. A person who draws a rectangle over the
      // note they were still writing in needs that commit, and a heavier-handed stop would take it away.
      event.stopPropagation();
      event.preventDefault();
      const start = propsRef.current.toWorld({ x: event.clientX, y: event.clientY });
      dragRef.current = {
        pointerId: event.pointerId,
        start,
        current: start,
        square: event.shiftKey,
      };
      show(dragRef.current);
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag === null || event.pointerId !== drag.pointerId) return;
      event.stopPropagation();
      drag.current = propsRef.current.toWorld({ x: event.clientX, y: event.clientY });
      drag.square = event.shiftKey;
      show(drag);
    };

    const onPointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag === null || event.pointerId !== drag.pointerId) return;
      event.stopPropagation();
      dragRef.current = null;
      setPreview(null);
      // A pointer the system took back is not a shape somebody asked for.
      if (event.type !== 'pointerup') return;
      drag.current = propsRef.current.toWorld({ x: event.clientX, y: event.clientY });
      drag.square = event.shiftKey;
      const owner = propsRef.current;
      const history = owner.undo;
      // A shape is one step of the history, for the same reason a note and a piece of text are: the write
      // that made it has to be undoable on its own, and not folded into the drag that happened before it.
      history?.boundary();
      const id = createShape(
        owner.doc,
        { kind: owner.kind, rect: dragged(drag.start, drag.current), at: drag.start, square: drag.square },
        owner.by ?? '',
      );
      history?.boundary();
      // A refusal creates nothing, says nothing and leaves the tool where it was: there is no shape to
      // select and no reason to believe the next drag will go better.
      if (typeof id === 'string') owner.onCreated(id);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      // An unfinished drag leaves with the tool, and takes nothing with it.
      dragRef.current = null;
      setPreview(null);
    };
    // Installed once for as long as the tool is on screen: the tool can change in the middle of the gesture
    // it owns — the release that creates a shape also puts the pointer back to Select — and the tail of
    // that gesture still belongs to the tool that began it.
  }, []);

  if (preview === null) return null;
  return (
    <div
      aria-hidden="true"
      className="shape-preview"
      data-testid="shape-preview"
      data-height={preview.height}
      data-width={preview.width}
      data-x={preview.x}
      data-y={preview.y}
      style={
        {
          position: 'fixed',
          left: `${preview.x}px`,
          top: `${preview.y}px`,
          width: `${Math.max(preview.width, 0)}px`,
          height: `${Math.max(preview.height, 0)}px`,
        } as React.CSSProperties
      }
    />
  );
}
