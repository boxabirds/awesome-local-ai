/**
 * The Connector tool (story 10): drag from one thing to another to join them.
 *
 * Like the Shape tool it owns the pointer while it is up. What it adds is the answer to "what would
 * this arrow attach to?": as the pointer crosses the board the object under it shows four dots, one
 * at the middle of each side, and while a drag is running the dot the arrow would leave from is
 * highlighted - the same `nearestSide` test the model uses to draw the finished arrow, so the dot
 * and the arrow cannot disagree.
 *
 * Nothing is written until the pointer comes up. An end released over an object is attached to it;
 * an end released over empty space is left exactly where it was released. A drop the model refuses -
 * back onto the object at the other end, or too short to be an arrow - creates nothing and leaves the
 * tool armed, which is what a person who mis-dragged expects: try again, no cleanup.
 */
import {
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import type { Endpoint } from '../../shared/objects/connector';
import { nearestSide, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';

export interface ConnectorCreateRequest {
  from: Endpoint;
  to: Endpoint;
}

export interface ConnectorToolProps {
  camera: Camera;
  /** Everything on the board, to find what the pointer is over. */
  snapshot: readonly ObjectSnapshot[];
  /** Asks the board for one arrow. A refusal leaves the tool where it was. */
  onCreate(request: ConnectorCreateRequest): void;
}

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** The gesture, in a ref so the release sees it whether or not React has caught up. */
interface Gesture {
  active: boolean;
  /** Where the pointer went down, on screen and in the world. */
  startScreen: Point;
  startWorld: Point;
  /** The object the drag started on, if any. */
  fromId: string | null;
}

export function ConnectorTool({ camera, snapshot, onCreate }: ConnectorToolProps): JSX.Element {
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    startScreen: Point;
    nowScreen: Point;
    targetId: string | null;
    side: Side | null;
  } | null>(null);
  const gesture = useRef<Gesture>({
    active: false,
    startScreen: { x: 0, y: 0 },
    startWorld: { x: 0, y: 0 },
    fromId: null,
  });

  /** The topmost object at a world point. Arrows are not objects an arrow can attach to. */
  const targetAt = (world: Point): ObjectSnapshot | null => {
    for (let i = snapshot.length - 1; i >= 0; i -= 1) {
      const obj = snapshot[i]!;
      if (obj.type === 'connector') continue;
      const box = objectBounds(obj);
      if (
        world.x >= box.x &&
        world.x <= box.x + box.width &&
        world.y >= box.y &&
        world.y <= box.y + box.height
      ) {
        return obj;
      }
    }
    return null;
  };

  const worldOf = (event: ReactPointerEvent): Point =>
    screenToWorld(camera, { x: event.clientX, y: event.clientY });

  /** The point an end is drawn towards: the middle of the object at the other end, or that point. */
  const otherEnd = (fromId: string | null, freeAt: Point): Point => {
    if (fromId === null) return freeAt;
    const obj = snapshot.find((candidate) => candidate.id === fromId);
    if (!obj) return freeAt;
    const box = objectBounds(obj);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startWorld = worldOf(event);
    const from = targetAt(startWorld);
    gesture.current = {
      active: true,
      startScreen: { x: event.clientX, y: event.clientY },
      startWorld,
      fromId: from?.id ?? null,
    };
    setDrag({
      startScreen: { x: event.clientX, y: event.clientY },
      nowScreen: { x: event.clientX, y: event.clientY },
      targetId: null,
      side: null,
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const world = worldOf(event);
    const hit = targetAt(world);
    setHover(hit?.id ?? null);
    if (!gesture.current.active) return;
    const now = { x: event.clientX, y: event.clientY };
    // The side that lights up is the side the finished arrow would leave from - the same test the
    // model runs, against the same other end, so the preview and the arrow agree.
    const target = hit && hit.id !== gesture.current.fromId ? hit : null;
    const side =
      target !== null
        ? nearestSide(objectBounds(target), otherEnd(gesture.current.fromId, gesture.current.startWorld))
        : null;
    setDrag({
      startScreen: gesture.current.startScreen,
      nowScreen: now,
      targetId: target?.id ?? null,
      side,
    });
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture.current.active) return;
    const started = gesture.current;
    gesture.current = { ...started, active: false };
    setDrag(null);
    setHover(null);

    const end = worldOf(event);
    const hit = targetAt(end);
    const from: Endpoint =
      started.fromId !== null
        ? { kind: 'attached', objectId: started.fromId, fallback: started.startWorld }
        : { kind: 'free', x: started.startWorld.x, y: started.startWorld.y };
    const to: Endpoint =
      hit !== null
        ? { kind: 'attached', objectId: hit.id, fallback: end }
        : { kind: 'free', x: end.x, y: end.y };
    // Anything the model refuses - the object at the other end, a line shorter than
    // CONNECTOR_MIN_LENGTH_WORLD - leaves no object and no state change behind, tool included.
    onCreate({ from, to });
  };

  const cancel = () => {
    gesture.current.active = false;
    setDrag(null);
  };

  // The object whose sides are on show: the one being dragged onto while a drag runs, otherwise the
  // one being hovered.
  const shownId = drag?.targetId ?? hover;
  const shown = shownId !== null ? snapshot.find((obj) => obj.id === shownId) : undefined;
  const radius = CONNECTOR_DOT_RADIUS_PX;

  return (
    <div
      className="tool-surface"
      data-testid="connector-tool-surface"
      style={{ cursor: 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        finish(event);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    >
      {shown
        ? SIDES.map((side) => {
            const anchor = worldToScreen(camera, sideAnchor(objectBounds(shown), side));
            const highlighted = drag !== null && drag.targetId === shown.id && drag.side === side;
            return (
              <div
                key={side}
                className="connector-tool__dot"
                data-connector-dot={side}
                data-target-id={shown.id}
                data-highlighted={highlighted ? 'true' : undefined}
                data-testid="connector-dot"
                aria-hidden="true"
                style={{
                  left: anchor.x - radius,
                  top: anchor.y - radius,
                  width: radius * 2,
                  height: radius * 2,
                }}
              />
            );
          })
        : null}
      {drag ? (
        <svg className="tool-surface__lines" aria-hidden="true">
          <line
            className="tool-surface__preview-line"
            data-testid="connector-preview"
            x1={drag.startScreen.x}
            y1={drag.startScreen.y}
            x2={drag.nowScreen.x}
            y2={drag.nowScreen.y}
          />
        </svg>
      ) : null}
    </div>
  );
}
