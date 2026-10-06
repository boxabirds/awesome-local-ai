/**
 * The Shape tool (story 10): drag out a shape, or click for one of the default size.
 *
 * The tool covers the board with its own surface, which is what "the tool owns the pointer" means
 * in practice: a drag that starts on top of a note draws a shape rather than moving the note
 * (TC-28), and no pan, marquee or object gesture happens underneath. Everything it does is local
 * until the pointer comes up, when it asks the board for exactly one shape. The preview is drawn in
 * screen space, so it does not care what the camera is doing.
 *
 * A drag becomes a rectangle in world coordinates. A drag too small to be a shape - and a click,
 * which is the same thing with nothing to it - becomes a shape of the default size centred where the
 * pointer went down, which is how a person gets a shape without measuring anything. Shift squares it
 * as it is dragged, and is read again on the way up: it can be pressed and released in the middle of
 * a gesture and still mean what the person meant when they let go.
 */
import {
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';

/** What the tool asks the board to create, in the words `createShape` takes. */
export interface ShapeCreateRequest {
  kind: ShapeKind;
  /** The dragged rectangle, or `null` when the gesture was a click or too small to be one. */
  rect: Rect | null;
  /** Where the drag began, in world units: where a default-sized shape is centred. */
  at: Point;
  /** Shift was held: the shape is a square. */
  square: boolean;
}

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  /** Asks the board for one shape. The board decides the history step and what becomes of the tool. */
  onCreate(request: ShapeCreateRequest): void;
}

/** The gesture, kept in a ref so the release sees it whether or not React has caught up. */
interface Gesture {
  active: boolean;
  start: Point;
}

/** The dashed rectangle that follows the pointer, in screen pixels. */
function previewStyle(start: Point, now: Point): CSSProperties {
  return {
    left: Math.min(start.x, now.x),
    top: Math.min(start.y, now.y),
    width: Math.abs(now.x - start.x),
    height: Math.abs(now.y - start.y),
  };
}

export function ShapeTool({ kind, camera, onCreate }: ShapeToolProps): JSX.Element {
  const [draft, setDraft] = useState<{ start: Point; now: Point; square: boolean } | null>(null);
  const gesture = useRef<Gesture>({ active: false, start: { x: 0, y: 0 } });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return; // touch is out of scope (story 1)
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = { x: event.clientX, y: event.clientY };
    gesture.current = { active: true, start };
    setDraft({ start, now: start, square: event.shiftKey });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture.current.active) return;
    setDraft((current) =>
      current
        ? { ...current, now: { x: event.clientX, y: event.clientY }, square: event.shiftKey }
        : current,
    );
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture.current.active) return;
    gesture.current.active = false;
    setDraft(null);

    const begin = screenToWorld(camera, gesture.current.start);
    const end = screenToWorld(camera, { x: event.clientX, y: event.clientY });
    const rect: Rect = {
      x: Math.min(begin.x, end.x),
      y: Math.min(begin.y, end.y),
      width: Math.abs(end.x - begin.x),
      height: Math.abs(end.y - begin.y),
    };
    // A drag with nothing in it is a click: the model is asked for a default-sized shape at the
    // point the pointer went down, rather than a sliver nobody meant to draw.
    const tooSmall = rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD;
    onCreate({ kind, rect: tooSmall ? null : rect, at: begin, square: event.shiftKey });
  };

  const cancel = () => {
    // a gesture that was taken away creates nothing at all
    gesture.current.active = false;
    setDraft(null);
  };

  return (
    <div
      className="tool-surface"
      data-testid="shape-tool-surface"
      data-tool-kind={kind}
      style={{ cursor: 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        finish(event);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onWheel={(event) => {
        // The tool sits over the board's own surface, so the wheel has to be handed down -
        // otherwise picking up a shape would cost the person the ability to zoom.
        const surface = document.querySelector('[data-board-surface]');
        if (surface instanceof Element) {
          surface.dispatchEvent(
            new WheelEvent('wheel', {
              deltaX: event.deltaX,
              deltaY: event.deltaY,
              deltaMode: event.deltaMode,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              clientX: event.clientX,
              clientY: event.clientY,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      }}
    >
      {draft ? (
        <div
          className="tool-surface__preview"
          data-testid="shape-preview"
          data-kind={kind}
          data-square={draft.square ? 'true' : undefined}
          style={previewStyle(draft.start, draft.now)}
        />
      ) : null}
    </div>
  );
}
