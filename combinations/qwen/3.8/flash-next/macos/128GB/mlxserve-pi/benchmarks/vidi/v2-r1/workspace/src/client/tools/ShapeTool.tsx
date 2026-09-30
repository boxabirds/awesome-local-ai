// Drawing a shape (`shape.create`, `shape.min_size`, `shape.place`).
//
// The tool is an invisible sheet over the board while the shape tool is the active one.
// It owns three things and nothing else:
//
//   - **Where the drag started and ended, in board units.** Screen points go through
//     `screenToWorld` and come out as the world's own numbers, which is what makes a
//     drag of 200 × 120 *pixels* at 100% produce a shape that is 200 × 120 *board units*
//     (TC-23) — and the same 200 × 120 board units come from a drag of 100 × 60 pixels at
//     200% zoom. How big the gesture looked in pixels means nothing; what it covered on
//     the board is everything, and the same is true of where it landed.
//
//   - **How big the shape ends up.** A drag is a box and becomes the shape. A click is
//     not a box, so it gets the standard size with its centre where you clicked, the way
//     a click with the note tool drops a note where you clicked. In between there is
//     `SHAPE_MIN_SIZE_WORLD`: a box dragged too small to be a shape was a click that
//     meant something, not a shape of that size (`shape.min_size`).
//
//   - **The preview.** The dashed box is drawn while you drag and is not the document:
//     one `createShape` goes into the shared document at the end, as one undo step. What
//     you see on the way is this screen's and nothing else's.
//
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { ShapeKind } from '../../shared/config';
import { createShape } from '../../shared/objects/shape';
import type { Point, Rect } from '../../shared/geometry';
import type { UndoController } from '../board/undo';

export interface ShapeToolProps {
  doc: Y.Doc;
  camera: Camera;
  /** Which shape this drag draws — the menu's choice, remembered from the last one. */
  kind: ShapeKind;
  /** The shape is in the document; the board selects it and the tool goes back. */
  onCreated(id: string): void;
  /** Escape, with nothing drawn: back to the select tool. */
  onCancelled(): void;
  /** This tab's undo history; the shape is one step. */
  undo?: UndoController;
}

export function ShapeTool({ doc, camera, kind, onCreated, onCancelled, undo }: ShapeToolProps): ReactNode {
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null);
  // Shift is held *at the moment of release*, so it is read from a ref: the release
  // handler has to see the truth of right then, not of the render it was created in.
  const shift = useRef(false);

  const world = (event: ReactPointerEvent<HTMLDivElement>): Point =>
    screenToWorld(camera, { x: event.clientX, y: event.clientY });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    // The board under the sheet does not pan, and a drag that starts here is never the
    // beginning of a marquee either.
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const at = world(event);
    setDrag({ from: at, to: at });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag === null) return;
    event.stopPropagation();
    setDrag({ from: drag.from, to: world(event) });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag === null) return;
    event.stopPropagation();
    const to = world(event);
    setDrag(null);
    // One undo step: the shape arrives once, with its size and style already right.
    // How big it ends up is not decided here — the drag's rectangle and whether Shift was
    // held go to the model, which is where `SHAPE_MIN_SIZE_WORLD`, the standard size a
    // click gets and the one maximum every object shares are written once (`shape.min_size`).
    undo?.boundary();
    const id = createShape(doc, { kind, rect: dragRect(drag.from, to), at: drag.from, square: shift.current }, '');
    undo?.boundary();
    // Nothing was written — a kind that is not a kind, a rectangle that is not a
    // rectangle — so nothing is selected and the tool stays up.
    if (id === null) return;
    onCreated(id);
  };

  useEffect(() => {
    const track = (event: KeyboardEvent): void => {
      shift.current = event.shiftKey;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      track(event);
      // Escape puts the tool away before it drew anything. Nothing was written, so there
      // is nothing for the board's undo to take back.
      if (event.key === 'Escape') {
        setDrag(null);
        onCancelled();
      }
    };
    // Shift is a key, not a pointer: it is tracked on the window, because a drag that
    // captured the pointer sends its key events wherever the board's own handler is not.
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', track);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', track);
    };
  }, [onCancelled]);

  const preview = previewScreenBox(camera, drag, shift.current);

  return (
    <div
      data-testid="shape-tool"
      data-kind={kind}
      aria-label={`Drawing a ${kind}`}
      style={sheetStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {preview ? (
        <div
          data-testid="shape-tool-preview"
          data-kind={kind}
          aria-hidden="true"
          style={{
            ...previewStyle,
            left: preview.x,
            top: preview.y,
            width: preview.width,
            height: preview.height,
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The rectangle a drag covers, in board units: the two corners it was drawn between,
 * however they came out. A drag that went up and to the left is the same rectangle as the
 * one that went down and to the right, which is what the model is given to draw.
 */
export function dragRect(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** The dashed box in screen pixels; nothing at all while no drag is going on. */
const previewScreenBox = (camera: Camera, drag: { from: Point; to: Point } | null, square: boolean): Rect | null => {
  if (drag === null) return null;
  const { from, to } = drag;
  let width = Math.abs(to.x - from.x);
  let height = Math.abs(to.y - from.y);
  // The preview says what the shape will be, so it is squared here exactly as the model
  // squares it there.
  if (square) width = height = Math.max(width, height);
  const far = {
    x: to.x >= from.x ? from.x + width : from.x - width,
    y: to.y >= from.y ? from.y + height : from.y - height,
  };
  const a = worldToScreen(camera, from);
  const b = worldToScreen(camera, far);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
};

const sheetStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  // The tool is between you and the board: the board cannot be panned or clicked through
  // it. The wheel is deliberately left to reach the board, so zooming while the tool is
  // up still zooms the board.
  cursor: 'crosshair',
  touchAction: 'none',
  userSelect: 'none',
};

const previewStyle: CSSProperties = {
  position: 'absolute',
  // The shape is not in the document yet, and this is this screen's drawing of what it
  // will be — which is why it is dashed.
  border: '1px dashed #1a73e8',
  backgroundColor: 'rgba(26, 115, 232, 0.08)',
  boxSizing: 'border-box',
  pointerEvents: 'none',
};
