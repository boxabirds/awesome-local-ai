// The Connector tool: drag from one shape to another and the board draws the
// arrow between them, attached to both.
//
// Like the Shape tool it takes the pointer in the capturing phase, on the window,
// and stops what it acts on: while an arrow is being drawn the board does not pan
// and the shape under the pointer does not start moving. It listens even when the
// pointer is over nothing, because half of what an arrow is attached to is the air
// — an end left free is a legitimate end, not a failed drag.
//
// Which shape an end belongs to is decided by the objects the board already holds
// and the hit tests their types define, so an arrow is attached to the same thing
// a click would have selected. Which side of it the arrow touches is decided by
// the model, on reading, and not here at all: this module only says which object
// an end is attached to and where the pointer was when it let go.

import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  type ConnectorEndpoint,
  type ConnectorSide,
} from '../../shared/config';
import { createConnector } from '../../shared/objects/connector';
import { allSides, nearestSide, rectCenter, sideAnchor } from '../../shared/geometry/connector-geometry';
import { getObjectType } from '../objects/registry';
import { screenToWorld, type Camera } from '../canvas/camera';
import type { UndoController } from '../board/undo';

export interface ConnectorToolOptions {
  doc: Y.Doc;
  camera: Camera;
  /** Everything on the board, as read: what an end can be attached to. */
  objects: readonly ObjectSnapshot[];
  /** The Connector tool is the board's active tool. */
  active: boolean;
  /** The board can be written to. */
  canEdit: boolean;
  undo?: UndoController;
  /** An arrow was made: select it, and go back to Select. */
  onCreated(id: string): void;
}

export interface ConnectorToolResult {
  /** The shape the pointer is over and could attach to, by id. */
  hoverId: string | null;
  /** The arrow in flight, in board units, or null when nothing is being drawn. */
  drag: ConnectorDrag | null;
}

/** An arrow being drawn: where its first end was anchored and where the second
 *  one is at now, plus what it would attach to if it were let go here. */
export interface ConnectorDrag {
  from: Point;
  to: Point;
  /** The object the moving end is over, which is the one whose nearest side is lit. */
  targetId: string | null;
  /** The side of that object the moving end would take. */
  targetSide: ConnectorSide | null;
}

/** The four attach dots of an object, in the same board units everything else is. */
export interface AttachDots {
  id: string;
  points: readonly { side: ConnectorSide; at: Point }[];
}

/** An arrow has to be attached to something that has a side to attach to, or be
 *  long enough to be an arrow; an arrow drawn from a shape to itself would be a
 *  dot, and the model says so too. */
function attachable(obj: ObjectSnapshot): boolean {
  return obj.type === 'shape' || obj.type === 'sticky' || obj.type === 'text';
}

/**
 * The object an arrow end would fasten to at this point: the topmost one whose
 * own hit test says the point is on it, at this zoom.
 *
 * It is the registry's test and not a box comparison of my own, so an end
 * fastens to what a click would have selected — a shape by its box, a sticky note
 * by its box, an arrow not at all, because an arrow is not something to fasten
 * another arrow to.
 */
export function attachTargetAt(
  objects: readonly ObjectSnapshot[],
  at: Point,
  zoom: number,
): ObjectSnapshot | null {
  let found: ObjectSnapshot | null = null;
  for (const obj of objects) {
    if (!attachable(obj)) continue;
    const spec = getObjectType(obj.type);
    if (spec === undefined || !spec.hitTest(obj, at, zoom)) continue;
    // The one nearest the top of the pile wins, as it does for a click.
    if (found === null || obj.z >= found.z) found = obj;
  }
  return found;
}

export function useConnectorTool(options: ConnectorToolOptions): ConnectorToolResult {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<ConnectorDrag | null>(null);
  const opts = useRef(options);
  const hoverRef = useRef<string | null>(null);
  const held = useRef<{ from: Point; fromId: string | null; pointerId: number } | null>(null);

  useEffect(() => {
    opts.current = options;
  });

  useEffect(() => {
    if (!options.active || !options.canEdit) return;

    /** The board's surface for this event, or null if the press is not its business. */
    const surfaceOf = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      if (target.closest('[role="toolbar"]') !== null) return null;
      if (target.closest('textarea') !== null) return null;
      return target.closest<HTMLElement>('[data-testid="board-viewport"]');
    };

    /** Board units, from a screen point. */
    const world = (e: { clientX: number; clientY: number }): Point | null => {
      const base = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
      if (base === null) return null;
      const rect = base.getBoundingClientRect();
      return screenToWorld(opts.current.camera, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    /** The topmost object a point is on, of the kinds an end attaches to. */
    const targetAt = (at: Point): ObjectSnapshot | null => attachTargetAt(opts.current.objects, at, opts.current.camera.zoom);

    const show = (id: string | null) => {
      if (hoverRef.current === id) return;
      hoverRef.current = id;
      setHoverId(id);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) return;
      if (surfaceOf(e.target) === null) return;
      const at = world(e);
      if (at === null) return;
      const target = targetAt(at);
      held.current = { from: at, fromId: target === null ? null : target.id, pointerId: e.pointerId };
      e.stopPropagation();
      e.preventDefault();
      setDrag({ from: at, to: at, targetId: target === null ? null : target.id, targetSide: null });
    };

    const onPointerMove = (e: PointerEvent) => {
      const going = held.current;
      const at = world(e);
      if (at === null) return;
      if (going === null) {
        // Not drawing: the shapes are being looked at, and the one the pointer is
        // on says where its ends would be attached. A move that arrives with a
        // button held is somebody else's drag, and not a look.
        if (e.pointerType === 'mouse' && typeof e.buttons === 'number' && e.buttons !== 0) return;
        const target = targetAt(at);
        show(target === null ? null : target.id);
        return;
      }
      if (e.pointerId !== going.pointerId) return;
      e.stopPropagation();
      const target = targetAt(at);
      // An arrow is not attached to the shape it started in at its other end.
      const over = target !== null && target.id !== going.fromId ? target : null;
      // While the pointer is over nothing at all it is still over the shape it
      // started from, whose dots are where the first end is going to be.
      show(over === null ? going.fromId : over.id);
      setDrag({
        from: going.from,
        to: at,
        targetId: over === null ? null : over.id,
        targetSide: over === null ? null : nearestSide(objectBounds(over), at),
      });
    };

    const finish = (e: PointerEvent, cancelled: boolean) => {
      const going = held.current;
      held.current = null;
      if (going === null || e.pointerId !== going.pointerId) return;
      e.stopPropagation();
      setDrag(null);
      if (cancelled) return;
      const at = world(e);
      if (at === null) return;
      const current = opts.current;
      const rects = rectsOf(current.objects);
      const target = targetAt(at);

      // Two things make a drag that was attempted not worth an arrow, and both are
      // said here rather than left to the model, because they are about the drag
      // and not about the arrow: it ended on the shape it started in, which is one
      // shape and not two to join; and it travelled less than an arrow is long,
      // which is a click that wobbled (connector.no_accidental).
      if (going.fromId !== null && target !== null && target.id === going.fromId) return;
      if (Math.hypot(at.x - going.from.x, at.y - going.from.y) < CONNECTOR_MIN_LENGTH_WORLD) return;

      const toId = target !== null && target.id !== going.fromId ? target.id : null;

      const from = endOf(going.fromId, going.from, rects, aimAcross(toId, at, going.from, rects));
      const to = endOf(toId, at, rects, aimAcross(going.fromId, going.from, at, rects));
      current.undo?.boundary();
      // A drag too short to be an arrow, an arrow from a shape to itself: the
      // model writes nothing and says so, and the tool stays where it was to
      // try again (connector.no_accidental).
      const id = createConnector(current.doc, { from, to });
      current.undo?.boundary();
      if (id !== null) current.onCreated(id);
    };

    const onPointerUp = (e: PointerEvent) => {
      finish(e, false);
    };
    const onPointerCancel = (e: PointerEvent) => {
      finish(e, true);
    };

    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointercancel', onPointerCancel, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerCancel, { capture: true });
      held.current = null;
      hoverRef.current = null;
      setDrag(null);
      setHoverId(null);
    };
  }, [options.active, options.canEdit]);

  return { hoverId, drag };
}

/** The boxes of everything an end can attach to, which is every object that has
 *  a side to attach to. */
export function rectsOf(objects: readonly ObjectSnapshot[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const obj of objects) {
    if (!attachable(obj)) continue;
    rects.set(obj.id, objectBounds(obj));
  }
  return rects;
}

/** Where the other end of the arrow being drawn will be aimed: the middle of the
 *  object it is fastened to, or the point it is a point in the air at. This is
 *  what decides which side an end is drawn to, so it is what the fallback stored
 *  beside a fastened end has to be worked out from: the fallback is where the end
 *  is left when its shape goes away, and a shape going away should not move it.
 *  The raw point the pointer released at is not that — it is on the shape, and the
 *  side it is nearest can be a side the other end, across the board from it, does
 *  not face. */
function aimAcross(objectId: string | null, fallback: Point, releasedAt: Point, rects: ReadonlyMap<string, Rect>): Point {
  const rect = objectId === null ? undefined : rects.get(objectId);
  return rect === undefined ? fallback : rectCenter(rect);
}

/** One end of the arrow being drawn: attached to the object the pointer was on,
 *  with the anchor of the side it is drawn to stored beside it — the side facing
 *  where the other end of the arrow is aimed, which is the side it is drawn on
 *  while it is attached, so an end orphaned by a delete is left exactly where it
 *  was drawn rather than jumped to wherever the pointer happened to be released;
 *  free at the point the pointer was at when there was none. */
export function endOf(
  objectId: string | null,
  at: Point,
  rects: ReadonlyMap<string, Rect>,
  aim: Point = at,
): ConnectorEndpoint {
  if (objectId === null) return { kind: 'free', x: at.x, y: at.y };
  const rect = rects.get(objectId);
  if (rect === undefined) return { kind: 'free', x: at.x, y: at.y };
  return { kind: 'attached', objectId, fallback: sideAnchor(rect, nearestSide(rect, aim)) };
}

/** The four attach dots of an object: the middles of its four sides, because a
 *  side is what an arrow knows how to attach to. */
export function attachDots(rect: Rect, id: string): AttachDots {
  return { id, points: allSides().map((side) => ({ side, at: sideAnchor(rect, side) })) };
}
