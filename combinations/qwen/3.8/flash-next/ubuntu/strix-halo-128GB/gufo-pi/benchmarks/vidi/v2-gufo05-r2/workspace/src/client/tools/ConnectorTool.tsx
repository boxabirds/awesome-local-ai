/**
 * Story 10: the Connector tool — drag from one thing to another and an arrow follows.
 *
 * Like the Shape tool, this is a layer over the whole board that owns the gesture while
 * it is held: a drag that starts on a sticky note must draw an arrow, not move the note.
 * On top of owning the gesture it reads the board — which object the pointer is over, and
 * which of its four sides the arrow would leave from — because that is what an arrow is:
 * not a line with two endpoints, but a relationship between two objects that happens to
 * be drawn as a line.
 *
 * So the tool never computes where an arrow will be drawn. It decides *what the ends
 * are* — attached to this object, or free at that board point — and the geometry is the
 * model's (`resolveEndpoints`), which every client derives the same way, every frame.
 *
 * Two things about the hand have to be remembered separately, and mixing them up is the
 * trap: the object the drag *started* on stays the arrow's first end however far the
 * pointer wanders, while the object under the pointer *now* is the end it would finish
 * at. Only the second one is allowed to change mid-drag.
 */

import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { ObjectSnapshot } from '../../shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import { nearestSide, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import { createConnector, type ConnectorEndpoint } from '../../shared/objects/connector';
import { worldToScreen, type Camera, type Point } from '../canvas/camera';
import { useBoardEnv } from '../board/boardEnv';
import { useUndoController } from '../board/useUndo';
import { hitTestObject } from '../objects/registry';

export interface ConnectorToolProps {
  camera: Camera;
  /** Every object on the board, as the board is drawing it this frame. */
  snapshot: readonly ObjectSnapshot[];
  /** The arrow was made: select it and put the hand back to Select. */
  onCreated(id: string): void;
}

const PRIMARY_MOUSE_BUTTON = 0;
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** The gesture, in board units. `fromId` is fixed at press; `toId` follows the pointer. */
interface Drag {
  from: Point;
  fromId: string | null;
  to: Point;
  toId: string | null;
}

export function ConnectorTool({ camera, snapshot, onCreated }: ConnectorToolProps) {
  const env = useBoardEnv();
  const undo = useUndoController();
  const layerRef = useRef<HTMLDivElement>(null);
  /** The object the pointer is over, whether or not anything is being dragged. */
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const rects = env?.rects ?? EMPTY_RECTS;

  /** What object (if any) this board point is on, topmost first. */
  const objectAt = (world: Point): ObjectSnapshot | null => {
    let best: ObjectSnapshot | null = null;
    for (const object of snapshot) {
      // An arrow cannot hold another arrow: its own ends are what it hangs from.
      if (object.type === 'connector') continue;
      if (!hitTestObject(object, world, { zoom: camera.zoom, rects })) continue;
      if (!best || object.z >= best.z) best = object;
    }
    return best;
  };

  /** The end a pointer at `world`, over `objectId`, means, hanging towards `toward`. */
  const endAt = (world: Point, objectId: string | null, toward: Point): ConnectorEndpoint =>
    endFor(world, objectId, rects, toward);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!env?.editable) return;
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    event.preventDefault();
    event.stopPropagation();
    const from = env.toWorld({ x: event.clientX, y: event.clientY });
    try {
      layerRef.current?.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic events have no capture; the layer covers the window, so the move
      // and the release still reach it.
    }
    const over = objectAt(from);
    setHoverId(over?.id ?? null);
    setDrag({ from, fromId: over?.id ?? null, to: from, toId: over?.id ?? null });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!env) return;
    const world = env.toWorld({ x: event.clientX, y: event.clientY });
    const over = objectAt(world)?.id ?? null;
    if (!drag) {
      setHoverId(over);
      return;
    }
    event.stopPropagation();
    // Past the edge of the window the pointer has left the board rather than the object,
    // so the target it had is kept: a hand that overshoots still means the thing it was
    // pointing at (PRD connector.attach).
    const offBoard =
      event.clientX < 0 ||
      event.clientY < 0 ||
      event.clientX > window.innerWidth ||
      event.clientY > window.innerHeight;
    const target = offBoard ? drag.toId : over;
    if (!offBoard) setHoverId(over);
    setDrag({ ...drag, to: world, toId: target });
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = drag;
    setDrag(null);
    if (!gesture || !env?.editable) return;
    event.stopPropagation();
    const to = env.toWorld({ x: event.clientX, y: event.clientY });
    const fromEnd = endAt(gesture.from, gesture.fromId, to);
    const toEnd = endAt(to, gesture.toId, gesture.from);
    undo?.boundary();
    const id = createConnector(env.doc, fromEnd, toEnd, env.identity);
    undo?.boundary();
    // A refused arrow — the same object at both ends, two free ends, a drag too short to
    // be an arrow — leaves the tool in the hand with nothing written.
    if (id) onCreated(id);
  };

  const cancel = () => setDrag(null);

  // The dots belong to the object under the pointer, whether or not anything is being
  // dragged (PRD connector.hover_points). While dragging, the one that wins — the side
  // facing the other end — is drawn filled, so you can see where the arrow will leave
  // before you let go.
  const hoverRect = hoverId !== null ? rects.get(hoverId) : undefined;
  const otherEnd = drag ? pointOf(endAt(drag.from, drag.fromId, drag.to)) : null;
  const activeSide =
    hoverRect && drag && otherEnd ? nearestSide(hoverRect, otherEnd) : null;

  // The preview runs between the two ends as they would be made, not between the raw
  // pointer positions: while it is held over an object, an arrow leaves its side.
  const preview = drag
    ? {
        from: pointOf(endAt(drag.from, drag.fromId, drag.to)),
        to: pointOf(endAt(drag.to, drag.toId, drag.from)),
      }
    : null;

  return (
    <div
      ref={layerRef}
      className="tool-layer"
      data-testid="connector-tool-layer"
      data-tool="connector"
      style={{ cursor: 'crosshair' } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {/* An SVG the size of the window, drawing in screen pixels: the dots stay four
          pixels across and the line one pixel wide at every zoom. */}
      <svg className="connector-tool__svg" aria-hidden="true" focusable="false">
        {preview ? <PreviewLine camera={camera} from={preview.from} to={preview.to} /> : null}
        {hoverRect
          ? SIDES.map((side) => {
              const anchor = worldToScreen(camera, sideAnchor(hoverRect, side));
              const on = side === activeSide;
              return (
                <circle
                  key={side}
                  className={`connector-dot${on ? ' connector-dot--active' : ''}`}
                  data-testid={`connector-dot-${side}`}
                  data-active={on ? 'true' : 'false'}
                  cx={anchor.x}
                  cy={anchor.y}
                  r={CONNECTOR_DOT_RADIUS_PX}
                />
              );
            })
          : null}
      </svg>
    </div>
  );
}

const EMPTY_RECTS: ReadonlyMap<string, Rect> = new Map();

/**
 * The end a drag starting or ending at `world` over `objectId` means.
 *
 * Over an object: attached, with the point it would hang from stored as its fallback —
 * that is what keeps the arrow where it hung if the object is deleted later, including
 * deleted by somebody else before this write lands. Over nothing: free, at the point.
 * `toward` is the other end, which decides the side.
 */
function endFor(
  world: Point,
  objectId: string | null,
  rects: ReadonlyMap<string, Rect>,
  toward: Point,
): ConnectorEndpoint {
  if (objectId === null) return { kind: 'free', x: world.x, y: world.y };
  const rect = rects.get(objectId);
  if (!rect) return { kind: 'free', x: world.x, y: world.y };
  const anchor = sideAnchor(rect, nearestSide(rect, toward));
  return { kind: 'attached', objectId, fallbackX: anchor.x, fallbackY: anchor.y };
}

/** Where an end is drawn right now: its anchor when the model has one, its point otherwise. */
function pointOf(end: ConnectorEndpoint): Point {
  return end.kind === 'attached'
    ? { x: end.fallbackX, y: end.fallbackY }
    : { x: end.x, y: end.y };
}

/** The arrow being drawn, from the end it started at to the pointer. */
function PreviewLine({ camera, from, to }: { camera: Camera; from: Point; to: Point }) {
  const a = worldToScreen(camera, from);
  const b = worldToScreen(camera, to);
  return (
    <line
      className="connector-tool__preview"
      data-testid="connector-preview"
      x1={a.x}
      y1={a.y}
      x2={b.x}
      y2={b.y}
    />
  );
}
