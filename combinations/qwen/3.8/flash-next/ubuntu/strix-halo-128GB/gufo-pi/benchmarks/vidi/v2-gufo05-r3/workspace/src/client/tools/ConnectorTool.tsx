/**
 * The Connector tool (story 10, `connector.create`, `connector.attach`).
 *
 * A screen-space layer over the board. Hovering an object shows the four places an
 * arrow can join it — the middle of each side — because those are the only anchors the
 * model will ever use, and a person is entitled to see where a thing will attach before
 * they commit to it. Dragging paints the arrow as it goes and enlarges the dot the
 * other end would choose, so the release is never a surprise.
 *
 * Hovering picks from the snapshot the screen is drawn from. The release picks again,
 * from the document: in the time between seeing a shape and letting go, someone else may
 * have moved or deleted it, and an arrow must not be aimed at a memory. If the target is
 * gone the end is simply free, and if the whole gesture was too short to be an arrow
 * nothing is written and the tool stays where it was.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX } from '../../shared/config';
import { SIDES, nearestSide, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import { pointInRect, type Point } from '../../shared/geometry';
import { attachTargetAt, attachTargets, createConnector, type Endpoint } from '../../shared/objects/connector';
import { getObjectType } from '../objects/registry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';

export interface ConnectorToolProps {
  doc: Y.Doc;
  camera: Camera;
  /** The board as drawn: hover picks come from here. */
  snapshot: readonly ObjectSnapshot[];
  by?: string;
  /** The arrow landed: select it and put the tool back to Select. */
  onCreated(id: string): void;
  onUndoBoundary?(): void;
}

interface Gesture {
  /** Where the press happened, in screen pixels inside this layer. */
  start: Point;
  /** Where the pointer is now. */
  cursor: Point;
}

export function ConnectorTool(props: ConnectorToolProps) {
  const { doc, camera, snapshot, by = 'local', onCreated, onUndoBoundary } = props;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const live = useRef({ doc, camera, snapshot, by, onCreated, onUndoBoundary });
  live.current = { doc, camera, snapshot, by, onCreated, onUndoBoundary };

  // The gesture's listeners, dropped if the tool is unmounted mid-drag (Escape puts the
  // tool down, and an arrow must not arrive from a drag nobody finished).
  const gestureStop = useRef<(() => void) | null>(null);
  useEffect(() => () => gestureStop.current?.(), []);

  const localOf = useCallback((clientX: number, clientY: number): Point => {
    const rect = layerRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (gesture) return; // the drag has its own listeners
      setCursor(localOf(event.clientX, event.clientY));
    },
    [gesture, localOf],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      event.stopPropagation();
      const start = localOf(event.clientX, event.clientY);
      const move = (e: PointerEvent): void => setGesture({ start, cursor: localOf(e.clientX, e.clientY) });
      const up = (e: PointerEvent): void => {
        gestureStop.current?.();
        setGesture(null);
        setCursor(null);
        finish(localOf(e.clientX, e.clientY), start);
      };
      // A cancelled gesture makes nothing at all.
      const cancel = (): void => {
        gestureStop.current?.();
        setGesture(null);
        setCursor(null);
      };
      gestureStop.current = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      };
      setGesture({ start, cursor: start });
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    },
    [localOf],
  );

  /** Make the arrow, or make nothing at all. */
  const finish = useCallback((end: Point, start: Point): void => {
    const here = live.current;
    const from = endpointAt(here.doc, here.camera, start, end);
    const to = endpointAt(here.doc, here.camera, end, start);
    here.onUndoBoundary?.();
    const id = createConnector(here.doc, from, to, here.by);
    here.onUndoBoundary?.();
    // Too short, or both ends on the same object: the model says no, the tool stays
    // up, and the board is exactly as it was.
    if (id) here.onCreated(id);
  }, []);

  /** The object under a screen point that an end may join, as it is drawn. */
  const pickAt = (screenPoint: Point): ObjectSnapshot | null => {
    const id = pick(live.current.snapshot, screenToWorld(camera, screenPoint));
    if (id === null) return null;
    return live.current.snapshot.find((object) => object.id === id) ?? null;
  };

  const hover = cursor === null ? null : pickAt(cursor);
  const hoverBounds = hover === null ? null : objectBounds(hover);
  // While dragging, the object the far end is over decides which dot is lit.
  const dragTarget = gesture ? pickAt(gesture.cursor) : null;
  const litSide: Side | null =
    gesture && dragTarget
      ? nearestSide(objectBounds(dragTarget), screenToWorld(camera, gesture.start))
      : null;

  const showDots = hover !== null && gesture === null;
  const startScreen = gesture ? gesture.start : { x: 0, y: 0 };
  const cursorScreen = gesture ? gesture.cursor : { x: 0, y: 0 };

  return (
    <div
      ref={layerRef}
      className="connector-tool-layer"
      data-tool-layer="connector"
      data-hover={hover?.id ?? ''}
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 4 }}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerLeave={() => setCursor(null)}
    >
      {showDots && hoverBounds ? (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
          {SIDES.map((side) => {
            const p = worldToScreen(camera, sideAnchor(hoverBounds, side));
            return (
              <circle
                key={side}
                data-connector-dot=""
                data-side={side}
                cx={p.x}
                cy={p.y}
                r={CONNECTOR_DOT_RADIUS_PX}
                fill="#ffffff"
                stroke={DOT_INK}
                strokeWidth={1.5}
              />
            );
          })}
        </svg>
      ) : null}

      {gesture ? (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
          <line
            data-testid="connector-preview"
            x1={startScreen.x}
            y1={startScreen.y}
            x2={cursorScreen.x}
            y2={cursorScreen.y}
            stroke={DOT_INK}
            strokeWidth={2}
            strokeDasharray="6 4"
          />
          {dragTarget && litSide
            ? (() => {
                const p = worldToScreen(camera, sideAnchor(objectBounds(dragTarget), litSide));
                return (
                  <circle
                    data-testid="connector-target-dot"
                    data-side={litSide}
                    data-attached-to={dragTarget.id}
                    cx={p.x}
                    cy={p.y}
                    r={CONNECTOR_DOT_RADIUS_PX + 2}
                    fill={DOT_INK}
                  />
                );
              })()
            : null}
        </svg>
      ) : null}
    </div>
  );
}

const DOT_INK = '#263238';

/** The topmost object at this point that an arrow end may join. */
function pick(objects: readonly ObjectSnapshot[], at: Point): string | null {
  let best: string | null = null;
  let bestZ = Number.NEGATIVE_INFINITY;
  for (const object of objects) {
    // An arrow does not join another arrow, and a type this build cannot draw is not
    // something to aim at either.
    if (object.type === 'connector' || !getObjectType(object.type)) continue;
    if (!pointInRect(at, objectBounds(object))) continue;
    if (object.z >= bestZ) {
      bestZ = object.z;
      best = object.id;
    }
  }
  return best;
}

/**
 * The endpoint for a press or release point: attached to the object there, parked at
 * the middle of the side that faces `toward`, or free at the point itself.
 */
function endpointAt(doc: Y.Doc, camera: Camera, at: Point, toward: Point): Endpoint {
  const world = screenToWorld(camera, at);
  const targetId = attachTargetAt(doc, world);
  if (targetId === null) return { kind: 'free', x: world.x, y: world.y };
  const target = attachTargets(doc).find((t) => t.id === targetId);
  if (!target) return { kind: 'free', x: world.x, y: world.y };
  return {
    kind: 'attached',
    objectId: target.id,
    fallback: sideAnchor(target.rect, nearestSide(target.rect, screenToWorld(camera, toward))),
  };
}
