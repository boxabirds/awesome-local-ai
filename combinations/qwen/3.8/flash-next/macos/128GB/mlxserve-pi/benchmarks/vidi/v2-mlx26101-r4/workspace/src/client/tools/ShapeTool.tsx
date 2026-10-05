/**
 * The Shape tool: press, drag, let go, and there is a shape.
 *
 * This is not an object and it is not a mode of the board — it is a sheet laid over the board for as long as
 * the tool is armed, which is the whole of how it works and worth saying out loud. Everything under it stops
 * being reachable while it is up: a press that lands on a sticky note with the Shape tool armed draws a
 * shape over that note and leaves the note exactly where it was. That is the behaviour the story asks for,
 * and it is not a rule this file has to remember to enforce — the press simply never arrives at the note, so
 * there is nothing here that can get it wrong. (A rule of the form "and now don't move the note" would be a
 * rule this file could break; a sheet that intercepts the press cannot.)
 *
 * **The drag is a promise, the write is the answer.** While the pointer travels, the box is drawn from local
 * state and nothing touches the document. One write happens, when the pointer lets go, and it is the model
 * that decides what the box means — a drag smaller than `SHAPE_MIN_SIZE_WORLD` becomes a shape of the
 * standard size, a drag that strayed into a `NaN` becomes nothing. The tool does not duplicate any of that;
 * it hands over what the pointer did and takes the id back.
 *
 * **It steps aside the moment it succeeds.** `onCreated` selects the new shape and puts the board back into
 * Select, which is what the story asks for and what a person expects: the thing they just drew is the thing
 * they want to move, label or connect, and every one of those is a Select job. When nothing is created — the
 * model refused the box, or the pointer was cancelled — the tool stays exactly where it was, because a tool
 * that gives up after a failure nobody was told about is a tool that has to be found again.
 */
import { useEffect, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import type { ShapeKind } from '../../shared/config';
import { createShape } from '../../shared/objects/shape';
import type { Point, Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { toolOverlayStyle, worldOfOverlay } from './toolOverlay';

/** The mouse button that draws. */
const PRIMARY_MOUSE_BUTTON = 0;

export interface ShapeToolProps {
  /** The board to draw on. Written to through the model, never directly. */
  doc: Y.Doc;
  /** Which of the three the next shape will be. */
  kind: ShapeKind;
  /** The camera this frame is drawn with, for turning the pointer's position into a place on the board. */
  camera: Camera;
  /** A shape was made: select it, and the tool is done. */
  onCreated(id: string): void;
}

/** The box between two points, the way a drag makes it: from any corner to any corner. */
function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** The same box with Shift holding its sides equal — the longer side, kept at the corner the drag started at. */
function squared(rect: Rect): Rect {
  const side = Math.max(rect.width, rect.height);
  return { x: rect.x, y: rect.y, width: side, height: side };
}

export function ShapeTool({ doc, kind, camera, onCreated }: ShapeToolProps): JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null);
  // The box being dragged, in board units, or nothing when the pointer is not down. Local on purpose: while
  // the pointer is travelling, the document holds no more opinion about this shape than it did before.
  const [preview, setPreview] = useState<Rect | null>(null);
  const press = useRef<{ pointerId: number; at: Point } | null>(null);

  /** The pointer's position, in board units. */
  const worldOf = (event: { clientX: number; clientY: number }): Point => worldOfOverlay(overlayRef, camera, event);

  const begin = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    // The press stops here. Not because the tool needs it, but because whatever is underneath — a note, a
    // shape, the board's own pan — was not what this press was aimed at.
    event.stopPropagation();
    const at = worldOf(event);
    press.current = { pointerId: event.pointerId, at };
    setPreview({ x: at.x, y: at.y, width: 0, height: 0 });
  };

  // Moves and releases are listened for on the window, in the capture phase, for as long as a press is held:
  // a drag that leaves the board — and a drag across a big shape leaves it sideways, over the toolbar — has
  // to keep drawing, and has to finish properly wherever it happens to let go.
  useEffect(() => {
    if (preview === null) return;

    const onMove = (event: PointerEvent): void => {
      const pressed = press.current;
      if (pressed === null || event.pointerId !== pressed.pointerId) return;
      const to = worldOf(event);
      const rect = rectBetween(pressed.at, to);
      setPreview(event.shiftKey ? squared(rect) : rect);
    };

    const onUp = (event: PointerEvent): void => {
      const pressed = press.current;
      press.current = null;
      setPreview(null);
      if (pressed === null || event.pointerId !== pressed.pointerId) return;
      const to = worldOf(event);
      const swept = rectBetween(pressed.at, to);
      // The model is the one that knows what a box means: too small becomes a shape of the standard size at
      // the point the press landed on, Shift is the same square the preview showed, and arithmetic that went
      // wrong creates nothing at all.
      const id = createShape(doc, {
        kind,
        rect: event.shiftKey ? squared(swept) : swept,
        at: pressed.at,
        createdBy: String(doc.clientID),
      });
      if (id !== null) onCreated(id);
    };

    const onCancel = (): void => {
      // The pointer was taken away (a system dialog, a second finger, the browser deciding). Nothing was
      // ever written, so there is nothing to put back: the preview is dropped and the tool waits.
      press.current = null;
      setPreview(null);
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
    };
  }, [camera, doc, kind, onCreated, preview === null]);

  // The preview is drawn in screen units, over the board: the same rectangle the drag swept, whether or not
  // the board was zoomed or scrolled while it was being swept.
  const box = preview === null ? null : screenBox(preview, camera);

  return (
    <div
      ref={overlayRef}
      className="tool-overlay tool-overlay--shape"
      data-testid="shape-tool"
      data-shape-kind={kind}
      style={toolOverlayStyle}
      onPointerDown={begin}
    >
      {box === null ? null : (
        <div
          className="tool-overlay__preview"
          data-testid="shape-preview"
          data-shape-kind={kind}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      )}
    </div>
  );
}

/** A box in board units, in the same units the sheet is drawn in. */
function screenBox(rect: Rect, camera: Camera): { left: number; top: number; width: number; height: number } {
  const origin = worldToScreen(camera, { x: rect.x, y: rect.y });
  return { left: origin.x, top: origin.y, width: rect.width * camera.zoom, height: rect.height * camera.zoom };
}
