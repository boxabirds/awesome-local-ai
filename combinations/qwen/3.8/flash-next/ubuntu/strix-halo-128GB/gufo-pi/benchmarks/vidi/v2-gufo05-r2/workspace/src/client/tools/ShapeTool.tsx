/**
 * Story 10: the Shape tool — press, drag, let go, and a shape is there.
 *
 * The tool is a layer over the whole board that owns every pointer gesture while it is
 * held. That is deliberate and it is the whole of PRD tool.owns_gesture: without it, a
 * drag that happened to start on a sticky note would move the note, because the note's
 * own press handler would answer first. With it, the press belongs to the tool, the
 * note does not move, and the rectangle the pointer describes becomes a shape of the
 * kind the toolbar picked (TC-28).
 *
 * The rule about what the drag means lives in the model, not here: `shapeBoxOf` turns a
 * dragged box, a click, and the Shift key into the rectangle that will be stored
 * (a drag under the minimum size becomes the standard shape, a square keeps the larger
 * side at the corner the drag started from). The preview is drawn from the same call, so
 * what you see while dragging is exactly what will be written — including mid-drag
 * Shift, which is read on every move rather than only at the start.
 */

import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import type { ShapeKind } from '../../shared/config';
import { createShape, shapeBoxOf } from '../../shared/objects/shape';
import type { Rect } from '../../shared/geometry';
import { worldToScreen, type Camera, type Point } from '../canvas/camera';
import { useBoardEnv } from '../board/boardEnv';
import { useUndoController } from '../board/useUndo';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  /** The shape was made: select it and put the hand back to Select. */
  onCreated(id: string): void;
}

const PRIMARY_MOUSE_BUTTON = 0;

export function ShapeTool({ kind, camera, onCreated }: ShapeToolProps) {
  const env = useBoardEnv();
  const undo = useUndoController();
  const layerRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
  const drag = useRef<{ start: Point; square: boolean } | null>(null);

  /** The box this pointer position means, or null when nothing is being dragged. */
  const boxAt = (event: ReactPointerEvent<HTMLDivElement>): Rect | null => {
    const started = drag.current;
    if (!started || !env) return null;
    const current = env.toWorld({ x: event.clientX, y: event.clientY });
    const square = event.shiftKey;
    started.square = square;
    // The model's rule, applied to the box so far — including the fallback to the
    // standard size, which is why a press with no drag already previews a whole shape.
    return shapeBoxOf(
      {
        x: started.start.x,
        y: started.start.y,
        width: current.x - started.start.x,
        height: current.y - started.start.y,
      },
      started.start,
      square,
    );
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!env?.editable) return;
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    event.preventDefault();
    event.stopPropagation();
    const start = env.toWorld({ x: event.clientX, y: event.clientY });
    drag.current = { start, square: event.shiftKey };
    try {
      layerRef.current?.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can fail for synthetic events; the move and up handlers are
      // on the layer itself, which covers the whole window.
    }
    // A press previews the standard shape straight away: it is what this press will
    // make if nothing else happens to it.
    setPreview(shapeBoxOf(null, start, event.shiftKey));
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    event.stopPropagation();
    setPreview(boxAt(event));
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const started = drag.current;
    drag.current = null;
    if (!started || !env?.editable) {
      setPreview(null);
      return;
    }
    event.stopPropagation();
    const current = env.toWorld({ x: event.clientX, y: event.clientY });
    const width = current.x - started.start.x;
    const height = current.y - started.start.y;
    // A drag too small in either direction is a click: the model is told `null` and
    // answers with the standard shape, so the rule is written once.
    const dragged =
      Math.abs(width) >= SHAPE_MIN_SIZE_WORLD && Math.abs(height) >= SHAPE_MIN_SIZE_WORLD
        ? { x: started.start.x, y: started.start.y, width, height }
        : null;
    setPreview(null);
    undo?.boundary();
    const id = createShape(
      env.doc,
      { kind, rect: dragged, at: started.start, square: event.shiftKey },
      env.identity,
    );
    undo?.boundary();
    // A shape that was refused (a kind with no drawing, a point that is not a place)
    // leaves the tool where it was, holding nothing.
    if (id) onCreated(id);
  };

  const cancel = () => {
    // Escape and a lost pointer: the gesture is dropped and nothing is written.
    drag.current = null;
    setPreview(null);
  };

  return (
    <div
      ref={layerRef}
      className="tool-layer"
      data-testid="shape-tool-layer"
      data-tool="shape"
      data-shape-kind={kind}
      style={{ cursor: 'crosshair' } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {preview ? <Preview kind={kind} box={preview} camera={camera} /> : null}
    </div>
  );
}

/**
 * The dashed outline of the shape being drawn, in screen pixels.
 *
 * It is drawn on the screen layer rather than in the world layer so its dashes stay one
 * pixel wide at every zoom — a preview that thickened as you zoomed would stop looking
 * like a promise and start looking like the thing itself.
 */
function Preview({ kind, box, camera }: { kind: ShapeKind; box: Rect; camera: Camera }) {
  const a = worldToScreen(camera, { x: box.x, y: box.y });
  const b = worldToScreen(camera, { x: box.x + box.width, y: box.y + box.height });
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  return (
    <div
      className={`shape-preview shape-preview--${kind}`}
      data-testid="shape-preview"
      style={
        {
          position: 'absolute',
          left,
          top,
          width,
          height,
        } as CSSProperties
      }
    />
  );
}
