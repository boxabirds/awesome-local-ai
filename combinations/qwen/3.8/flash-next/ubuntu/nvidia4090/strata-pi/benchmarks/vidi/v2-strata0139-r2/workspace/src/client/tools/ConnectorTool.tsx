import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import type { ObjectSnapshot } from "../../shared/board-model";
import { objectBounds } from "../../shared/board-model";
import {
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HANDLE_SIZE_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
} from "../../shared/config";
import { createConnector, setConnectorEndpoint } from "../../shared/objects/connector";
import { nearestSide, resolveEndpoints, sideAnchor } from "../../shared/geometry/connector-geometry";
import type { Point, Rect } from "../../shared/geometry";
import type { Camera } from "../canvas/camera";
import { screenToWorld, worldToScreen } from "../canvas/camera";
import { getObjectType } from "../objects/registry";
import { isBoardControl, useCaptureGestures } from "./useCaptureGestures";

/**
 * The Connector tool (`connector.ui`, story 10).
 *
 * What a press does depends on where it lands. On a board object it starts an
 * arrow from the midpoint of that object's side nearest the pointer; on one of a
 * selected arrow's ends it picks that end up; on empty board space it does
 * nothing at all, and the board pans, marquee-ing and clicking exactly as they do
 * in Select mode.
 *
 * On release the arrow is attached to whatever object is under the pointer, or
 * fixed to that board point if nothing is (`connector.create_free`). The rules
 * that decide whether anything is created at all — never an arrow from an object
 * to itself, never one shorter than `CONNECTOR_MIN_LENGTH_WORLD`, never a second
 * arrow between the same pair — are the model's, and a rejection leaves the tool
 * where it was with nothing written.
 *
 * The four dots are the tool saying where an arrow can start and land: they are
 * the side midpoints of the object the pointer is over, and the one the arrow
 * would attach to is highlighted while dragging.
 */

export interface ConnectorToolProps {
  doc: Y.Doc;
  camera: Camera;
  zoom: number;
  /** The board as it is now, for hit-testing and for the arrow's ends. */
  snapshot: readonly ObjectSnapshot[];
  /** The connector ids this client has selected: their ends can be re-attached. */
  selectedConnectorIds: readonly string[];
  /** True while the Connector tool itself is active. Handles work in Select too. */
  toolActive: boolean;
  canEdit: boolean;
  onGestureBoundary?(): void;
  onCreated(id: string): void;
}

type Drag =
  | { kind: "new"; fromId: string; anchor: Point; current: Point; targetId: string | null }
  | { kind: "handle"; connectorId: string; end: "from" | "to"; anchor: Point; current: Point; targetId: string | null };

export function ConnectorTool({
  doc,
  camera,
  zoom,
  snapshot,
  selectedConnectorIds,
  toolActive,
  canEdit,
  onGestureBoundary,
  onCreated,
}: ConnectorToolProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Latest board state: a release must be decided against the objects as they are
  // the moment the pointer lets go, not as they were when it pressed.
  const latest = useRef({ doc, camera, zoom, snapshot, selectedConnectorIds, toolActive, canEdit, onGestureBoundary, onCreated });
  latest.current = { doc, camera, zoom, snapshot, selectedConnectorIds, toolActive, canEdit, onGestureBoundary, onCreated };

  const dragRef = useRef<Drag | null>(null);

  const hitObject = useCallback(
    (world: Point, objects: readonly ObjectSnapshot[]): string | null => {
      // The topmost object under the point wins.
      for (let index = objects.length - 1; index >= 0; index -= 1) {
        const object = objects[index];
        if (object.type === "connector") continue;
        const spec = getObjectType(object.type);
        if (!spec) continue;
        if (spec.hitTest(object, world)) return object.id;
      }
      return null;
    },
    [],
  );

  /** A selected arrow's end within reach of the pointer, in board units. */
  const hitHandle = useCallback((world: Point): Drag | null => {
    const { snapshot: objects, selectedConnectorIds: selected, zoom: boardZoom } = latest.current;
    const reach = CONNECTOR_HIT_TOLERANCE_PX + CONNECTOR_HANDLE_SIZE_PX / 2;
    const tolerance = reach / (boardZoom > 0 ? boardZoom : 1);
    for (const object of objects) {
      if (object.type !== "connector" || !selected.includes(object.id)) continue;
      if (object.from === undefined || object.to === undefined) continue;
      const ends = resolveEndpoints(
        { from: object.from, to: object.to },
        rectsOf(objects),
      );
      if (Math.hypot(ends.from.x - world.x, ends.from.y - world.y) <= tolerance) {
        return { kind: "handle", connectorId: object.id, end: "from", anchor: ends.to, current: world, targetId: null };
      }
      if (Math.hypot(ends.to.x - world.x, ends.to.y - world.y) <= tolerance) {
        return { kind: "handle", connectorId: object.id, end: "to", anchor: ends.from, current: world, targetId: null };
      }
    }
    return null;
  }, []);

  const finish = useCallback((event: PointerEvent) => {
    const press = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (press === null) return;

    const { doc: document, camera: cam, snapshot: objects, onGestureBoundary: boundary, onCreated: created } = latest.current;
    const world = screenToWorld(cam, { x: event.clientX, y: event.clientY });
    const targetId = hitObject(world, objects);

    boundary?.();
    let id: string | null | false = null;

    if (press.kind === "new") {
      id =
        targetId === null
          ? createConnector(document, { kind: "attached", objectId: press.fromId }, { kind: "free", x: world.x, y: world.y })
          : createConnector(document, { kind: "attached", objectId: press.fromId }, { kind: "attached", objectId: targetId });
    } else {
      const connector = objects.find((object) => object.id === press.connectorId);
      const other = connector === undefined ? null : oppositeEnd(connector, press.end);
      // Released over the object at the other end: an arrow may not end where it
      // starts, so the handle simply snaps back and nothing is written.
      if (targetId !== null && targetId === other) return;
      const applied =
        targetId === null
          ? setConnectorEndpoint(document, press.connectorId, press.end, { kind: "free", x: world.x, y: world.y })
          : setConnectorEndpoint(document, press.connectorId, press.end, { kind: "attached", objectId: targetId });
      if (applied) id = press.connectorId;
    }

    boundary?.();
    if (typeof id === "string") created(id);
  }, [hitObject]);

  useCaptureGestures(canEdit, {
    onPointerDown: (event, point) => {
      if (isBoardControl(event.target)) return false;
      const { camera: cam, snapshot: objects, toolActive: active } = latest.current;
      const world = screenToWorld(cam, point);

      // An end handle of a selected arrow is always pickable.
      const handle = hitHandle(world);
      if (handle !== null) {
        dragRef.current = handle;
        setDrag(handle);
        return true;
      }

      if (!active) return false;

      // A press on a board object starts an arrow from that object's outline.
      const fromId = hitObject(world, objects);
      if (fromId === null) return false;
      const rect = rectOf(objects, fromId);
      if (rect === null) return false;
      const anchor = sideAnchor(rect, nearestSide(rect, world));
      const press: Drag = { kind: "new", fromId, anchor, current: world, targetId: null };
      dragRef.current = press;
      setDrag(press);
      return true;
    },
    onPointerMove: (event, point) => {
      const press = dragRef.current;
      if (press === null) return;
      const { camera: cam, snapshot: objects } = latest.current;
      const world = screenToWorld(cam, point);
      const next: Drag = { ...press, current: world, targetId: hitObject(world, objects) };
      dragRef.current = next;
      setDrag(next);
    },
    onPointerUp: (event) => finish(event),
    onPointerCancel: () => {
      // A cancelled gesture creates nothing.
      dragRef.current = null;
      setDrag(null);
    },
  });

  // Hovering, with no press in progress: the tool shows the four side midpoints of
  // the object under the pointer (`connector.hover_points`).
  useEffect(() => {
    if (!toolActive) {
      setHoverId(null);
      return;
    }
    const onPointerMove = (event: PointerEvent) => {
      if (dragRef.current !== null) return;
      const { camera: cam, snapshot: objects } = latest.current;
      setHoverId(hitObject(screenToWorld(cam, { x: event.clientX, y: event.clientY }), objects));
    };
    document.addEventListener("pointermove", onPointerMove);
    return () => document.removeEventListener("pointermove", onPointerMove);
  }, [toolActive, hitObject]);

  // ---- what the tool draws ------------------------------------------------
  const shown = drag ?? null;
  const hoverRect = hoverId === null ? null : rectOf(latest.current.snapshot, hoverId);
  if (shown === null && hoverRect === null) return null;

  const dots = (rect: Rect, highlighted: Point | null) =>
    (["left", "right", "top", "bottom"] as const).map((side) => {
      const world = sideAnchor(rect, side);
      const screen = worldToScreen(camera, world);
      return (
        <div
          key={side}
          className="connector-endpoint-dot"
          data-testid="connector-endpoint-dot"
          data-side={side}
          data-highlighted={highlighted !== null && samePoint(highlighted, world) ? "true" : "false"}
          style={{
            left: `${screen.x - CONNECTOR_DOT_RADIUS_PX}px`,
            top: `${screen.y - CONNECTOR_DOT_RADIUS_PX}px`,
            width: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
            height: `${CONNECTOR_DOT_RADIUS_PX * 2}px`,
          }}
        />
      );
    });

  const targetRect = shown !== null && shown.targetId !== null ? rectOf(latest.current.snapshot, shown.targetId) : null;
  const highlight = targetRect === null ? null : sideAnchor(targetRect, nearestSide(targetRect, shown?.anchor ?? shown?.current ?? { x: 0, y: 0 }));

  const start = shown === null ? null : worldToScreen(camera, shown.anchor);
  const end = shown === null ? null : worldToScreen(camera, shown.current);

  return (
    <div className="connector-tool-layer" data-testid="connector-tool-layer" aria-hidden="true">
      {hoverRect !== null ? dots(hoverRect, null) : null}
      {shown !== null && targetRect !== null ? dots(targetRect, highlight) : null}
      {shown !== null && start !== null && end !== null ? (
        <svg className="connector-preview" data-testid="connector-preview" width="100%" height="100%">
          <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
        </svg>
      ) : null}
    </div>
  );
}

// ---- helpers --------------------------------------------------------------

/** The object at the other end of a connector, or null when it is not attached. */
function oppositeEnd(connector: ObjectSnapshot, end: "from" | "to"): string | null {
  const other = end === "from" ? connector.to : connector.from;
  return other !== undefined && other.kind === "attached" ? other.objectId : null;
}

function rectOf(objects: readonly ObjectSnapshot[], id: string): Rect | null {
  const object = objects.find((entry) => entry.id === id);
  return object === undefined ? null : objectBounds(object);
}

function rectsOf(objects: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const object of objects) {
    if (object.type === "connector") continue;
    rects.set(object.id, objectBounds(object));
  }
  return rects;
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}
