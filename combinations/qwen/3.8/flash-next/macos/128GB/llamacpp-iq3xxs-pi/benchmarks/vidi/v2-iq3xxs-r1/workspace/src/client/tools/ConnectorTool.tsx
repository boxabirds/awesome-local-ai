import { useEffect, useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { rectContains } from '../../shared/geometry';
import { nearestSide, sideAnchor, SIDES, type Side } from '../../shared/geometry/connector-geometry';
import { createConnector, type EndpointInput } from '../../shared/objects/connector';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';

export interface ConnectorToolProps {
  camera: Camera;
  /** Every object on the board, so an attachable one can be found under the pointer. */
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  /** Recorded as the connector's author. */
  createdBy: string;
  /** The connector was created: it gets selected and the tool goes back to Select. */
  onCreated(id: string): void;
}

/** The topmost object under a world point that an arrow may be attached to. */
export function attachTargetAt(
  snapshot: readonly ObjectSnapshot[],
  world: Point,
): ObjectSnapshot | null {
  let top: ObjectSnapshot | null = null;
  for (const obj of snapshot) {
    // An arrow is not an attachable object (design: connectors are not targets).
    if (obj.type === 'connector') continue;
    if (!rectContains(objectBounds(obj), { x: world.x, y: world.y, width: 0, height: 0 })) continue;
    if (top === null || obj.z >= top.z) top = obj;
  }
  return top;
}

interface Drag {
  /** Where the press happened: an object id, or the world point it was pressed on. */
  start: EndpointInput;
  /** That end as a point, so the preview line has somewhere to start from. */
  startAt: Point;
  /** The pointer's current world position, which the preview line is drawn to. */
  current: Point;
  /** The object the release would attach to, if any. */
  target: string | null;
}

/**
 * The Connector tool's own surface (PRD conn.attach, conn.endpoint, conn.cancel).
 *
 * A press inside an object means "from this object"; anywhere else it means "from
 * this point". While the pointer is held down it draws a line from the start to the
 * pointer, the object under the pointer shows its four side anchors, and the one
 * facing the start is marked: that is the side the arrow will join. Releasing over
 * another object attaches both ends; releasing over empty space leaves that end
 * where the pointer was; a release on the object it started from is refused and the
 * tool stays active for another try (TC-21).
 */
export function ConnectorTool({ camera, snapshot, doc, createdBy, onCreated }: ConnectorToolProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Object whose side anchors are shown: the one under the pointer. */
  const [hover, setHover] = useState<string | null>(null);
  const pressRef = useRef<EndpointInput | null>(null);
  const live = useRef({ camera, snapshot, doc, createdBy, onCreated });
  live.current = { camera, snapshot, doc, createdBy, onCreated };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const toWorld = (e: { clientX: number; clientY: number }): Point => {
      const rect = el.getBoundingClientRect();
      return screenToWorld(live.current.camera, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    const targetUnder = (e: { clientX: number; clientY: number }): ObjectSnapshot | null =>
      attachTargetAt(live.current.snapshot, toWorld(e));

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      e.preventDefault();
      const world = toWorld(e);
      const hit = targetUnder(e);
      // Story 4: a press on the board belongs to the tool, never to an object under it.
      const start: EndpointInput = hit
        ? { kind: 'attached', objectId: hit.id }
        : { kind: 'free', x: world.x, y: world.y };
      pressRef.current = start;
      setDrag({
        start,
        startAt: hit ? centerOf(hit) : world,
        current: world,
        target: hit?.id ?? null,
      });
      setHover(hit?.id ?? null);
    };

    const onHover = (e: PointerEvent): void => {
      if (pressRef.current) return;
      setHover(targetUnder(e)?.id ?? null);
    };

    const onDragMove = (e: PointerEvent): void => {
      if (!pressRef.current) return;
      const world = toWorld(e);
      const target = targetUnder(e)?.id ?? null;
      // Only the pointer and the target move during a drag; the start stays where the
      // press happened, even if the object it was pressed on has itself moved.
      setDrag((prev) => (prev ? { ...prev, current: world, target } : prev));
    };

    const onPointerUp = (e: PointerEvent): void => {
      const start = pressRef.current;
      if (!start) return;
      pressRef.current = null;
      const world = toWorld(e);
      const hit = targetUnder(e);
      setDrag(null);
      setHover(hit?.id ?? null);
      const end: EndpointInput = hit
        ? { kind: 'attached', objectId: hit.id }
        : { kind: 'free', x: world.x, y: world.y };
      const id = createConnector(live.current.doc, start, end, live.current.createdBy);
      // Refused (both ends the same object, or too short): the tool stays active.
      if (id) live.current.onCreated(id);
    };

    const onPointerCancel = (): void => {
      pressRef.current = null;
      setDrag(null);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onHover);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onHover);
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, []);

  // Dots belong to the object under the pointer; while dragging they follow the
  // pointer to whatever the release would join, and the side that would be used is
  // marked so the choice can be seen before releasing (TC-18).
  const dotId = drag ? drag.target : hover;
  const dotObject = live.current.snapshot.find((o) => o.id === dotId) ?? null;
  // While merely hovering, every dot is equally possible; during a drag the side the
  // arrow would actually join is marked (TC-18).
  const highlighted: Side | null =
    dotObject && drag ? nearestSide(objectBounds(dotObject), drag.startAt) : null;

  return (
    <div
      ref={rootRef}
      className="connector-tool-layer"
      data-testid="connector-tool"
      aria-label="Connector tool"
    >
      <svg className="connector-tool-svg" aria-hidden="true">
        {drag ? <PreviewLine from={drag.startAt} to={drag.current} camera={camera} /> : null}
      </svg>
      {dotObject
        ? SIDES.map((side) => {
            const at = worldToScreen(camera, sideAnchor(objectBounds(dotObject), side));
            return (
              <div
                key={side}
                className="connector-dot"
                data-testid="connector-dot"
                data-side={side}
                data-object-id={dotObject.id}
                data-highlighted={highlighted === side ? 'true' : 'false'}
                style={{ left: `${at.x}px`, top: `${at.y}px` }}
              />
            );
          })
        : null}
    </div>
  );
}

/** Centre of an object, used to pick the side an attached end points through. */
function centerOf(obj: ObjectSnapshot | undefined): Point {
  if (!obj) return { x: 0, y: 0 };
  const b = objectBounds(obj);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * The line being drawn, from the object it started on (or the point it started at)
 * to the pointer, in screen space so its width and dashes stay legible at any zoom.
 */
export function PreviewLine({
  from,
  to,
  camera,
}: {
  from: Point;
  to: Point;
  camera: Camera;
}): JSX.Element {
  const a = worldToScreen(camera, from);
  const b = worldToScreen(camera, to);
  return (
    <line
      data-testid="connector-preview"
      className="connector-preview-line"
      x1={a.x}
      y1={a.y}
      x2={b.x}
      y2={b.y}
    />
  );
}
