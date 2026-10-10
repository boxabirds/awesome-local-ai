import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import {
  completeConnectorEndpoints,
  connectorAnchorRectsFrom,
  createConnector,
  type EndpointInput,
} from '../../shared/objects/connector';
import {
  nearestSide,
  resolveEndpoints,
  type Side,
} from '../../shared/geometry/connector-geometry';
import { rectContainsPoint, type Point, type Rect } from '../../shared/geometry';
import type { BoardSurface } from '../canvas/BoardViewport';
import { isBoardChrome, isTypingTarget, worldPointOf } from './toolPointer';

/**
 * The Connector tool (`connector.tool`, `connector.endpoints`, `connector.attach`).
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Idle
 *     Idle --> Hover : pointermove over an object (four dots at its side midpoints)
 *     Hover --> Idle : pointermove over empty space
 *     Idle --> Drag : pointerdown on an object (the near end attaches to it)
 *     Hover --> Drag : pointerdown on the hovered object
 *     Drag --> Drag : pointermove: the far end snaps to the object under it, or is free
 *     Drag --> Idle : pointerup creates one connector, selects it, tool back to Select
 *     Drag --> Idle : a rejected arrow creates nothing and the tool stays armed
 *     Drag --> Idle : pointercancel creates nothing
 * ```
 *
 * Like the Shape tool, the listeners are on `window` in the capture phase and stop
 * the press reaching the board: an arrow started over a shape must not move that
 * shape or clear the selection, and a press that finds no object to attach to is
 * left alone so the board's ordinary click still clears the selection.
 *
 * The preview is the *completed* arrow - the same `completeConnectorEndpoints` the
 * model will run - so the arrow a person releases is the arrow they were shown.
 */

export interface ConnectorToolArgs {
  doc: Y.Doc;
  armed: boolean;
  /** The current render model: what the board is showing is what an end can attach to. */
  objects: readonly ObjectSnapshot[];
  surface: BoardSurface | null;
  createdBy: string;
  onCreated(id: string): void;
}

export interface ConnectorToolGesture {
  /** The arrow being dragged, in world units. */
  readonly preview: { from: Point; to: Point } | null;
  /** The object showing its four attach dots, and which one the near end is on. */
  readonly dots: { rect: Rect; active: Side | null } | null;
}

interface LiveDrag {
  pointerId: number;
  from: EndpointInput;
  /** The object the near end is attached to, so the far end can never pick it too. */
  fromId: string;
  to: EndpointInput;
}

/** The topmost object a point is on that an arrow may attach to (`connector.attach`). */
function attachTargetAt(
  objects: readonly ObjectSnapshot[],
  world: Point,
  exclude: ReadonlySet<string>,
): ObjectSnapshot | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const obj = objects[index];
    if (!obj || obj.type === 'connector') {
      continue; // an arrow is not something to attach an arrow to
    }
    if (exclude.has(obj.id)) {
      continue;
    }
    if (rectContainsPoint(objectBounds(obj), world)) {
      return obj;
    }
  }
  return null;
}

export function useConnectorTool(args: ConnectorToolArgs): ConnectorToolGesture {
  const [preview, setPreview] = useState<{ from: Point; to: Point } | null>(null);
  const [dots, setDots] = useState<{ rect: Rect; active: Side | null } | null>(null);

  const dragRef = useRef<LiveDrag | null>(null);
  /** Which object the four dots are currently drawn for: compared before setting state. */
  const hoverRef = useRef<string | null>(null);

  const inputs = useRef(args);
  inputs.current = args;

  useEffect(() => {
    if (!args.armed) {
      // Dropping the tool drops the arrow in progress and the dots (`connector.tool`).
      dragRef.current = null;
      hoverRef.current = null;
      setPreview(null);
      setDots(null);
      return undefined;
    }

    const showDots = (rect: Rect | null, active: Side | null): void => {
      const key = rect ? `${rect.x}:${rect.y}:${rect.width}:${rect.height}:${active ?? ''}` : '';
      if (hoverRef.current === key) {
        return;
      }
      hoverRef.current = key;
      setDots(rect ? { rect, active } : null);
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || dragRef.current !== null) {
        return;
      }
      if (isBoardChrome(event.target) || isTypingTarget(event.target)) {
        return;
      }
      const current = inputs.current;
      const world = worldPointOf(event, current.surface);
      if (!world) {
        return;
      }
      const target = attachTargetAt(current.objects, world, new Set());
      if (!target) {
        return; // nothing to attach to: the board's own click still happens, as normal
      }
      event.stopPropagation();
      const drag: LiveDrag = {
        pointerId: event.pointerId,
        from: { kind: 'attached', objectId: target.id },
        fromId: target.id,
        // Until the pointer leaves, the far end is where the press landed.
        to: { kind: 'free', x: world.x, y: world.y },
      };
      dragRef.current = drag;
      draw(drag);
    };

    /**
     * Show the arrow exactly as the model will store it (`connector.endpoints`):
     * the same completion, resolved against the same rectangles the board is
     * drawing. A preview that guessed - a side picked by eye, an end that the model
     * would then move - would be an arrow that jumps when it is released.
     */
    const draw = (drag: LiveDrag): void => {
      const current = inputs.current;
      const rects = connectorAnchorRectsFrom(current.objects);
      const completed = completeConnectorEndpoints(drag.from, drag.to, rects);
      const bothEnds = (end: 'from' | 'to'): string | null =>
        drag[end].kind === 'attached' ? drag[end].objectId : null;
      if (!completed || (bothEnds('from') !== null && bothEnds('from') === bothEnds('to'))) {
        // An arrow attached twice to one object is not created at all, so there is
        // nothing to draw for it (`connector.no_accidental`).
        setPreview(null);
        showDots(null, null);
        return;
      }
      const points = resolveEndpoints(completed, rects);
      setPreview(points);

      /** Which side of an object the completed end is drawn from right now. */
      const attachSide = (end: 'from' | 'to'): Side | null => {
        const endpoint = completed[end];
        if (endpoint.kind !== 'attached') {
          return null;
        }
        const rect = rects.get(endpoint.objectId);
        if (!rect) {
          return null;
        }
        return nearestSide(rect, end === 'from' ? points.to : points.from);
      };

      // The dots belong to the object the pointer is over while dragging; over empty
      // space they stay on the object the arrow already starts from.
      const shown =
        drag.to.kind === 'attached'
          ? { rect: rects.get(drag.to.objectId), active: attachSide('to') }
          : { rect: rects.get(drag.fromId), active: attachSide('from') };
      showDots(shown.rect ?? null, shown.active);
    };

    const onPointerMove = (event: PointerEvent): void => {
      const current = inputs.current;
      const world = worldPointOf(event, current.surface);
      if (!world) {
        return;
      }
      const drag = dragRef.current;
      if (drag) {
        if (event.pointerId !== drag.pointerId) {
          return;
        }
        event.stopPropagation();
        // Nothing is excluded: the object the drag started from is a target like any
        // other, and the answer the model gives to an arrow attached twice to one
        // object is the answer the preview shows (no arrow at all).
        const target = attachTargetAt(current.objects, world, new Set());
        drag.to = target
          ? { kind: 'attached', objectId: target.id }
          : { kind: 'free', x: world.x, y: world.y };
        draw(drag);
        return;
      }
      // Idle: the four dots follow the pointer from object to object (`connector.attach`).
      const target = attachTargetAt(current.objects, world, new Set());
      showDots(target ? objectBounds(target) : null, null);
    };

    const onPointerUp = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      event.stopPropagation();
      dragRef.current = null;
      setPreview(null);
      showDots(null, null);
      const current = inputs.current;
      const world = worldPointOf(event, current.surface);
      if (world) {
        const target = attachTargetAt(current.objects, world, new Set());
        drag.to = target
          ? { kind: 'attached', objectId: target.id }
          : { kind: 'free', x: world.x, y: world.y };
      }
      // Over empty space the far end is simply free, where it was released
      // (`connector.attach`); too short or aimed at the same object, the model says
      // no and nothing is created (`connector.create`, TC-08, TC-09).
      const id = createConnector(current.doc, drag.from, drag.to, current.createdBy);
      if (id !== null) {
        current.onCreated(id);
      }
    };

    const onPointerCancel = (event: PointerEvent): void => {
      if (dragRef.current?.pointerId !== event.pointerId) {
        return;
      }
      dragRef.current = null;
      setPreview(null);
      showDots(null, null); // nothing was created (`connector.tool`)
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      dragRef.current = null;
      hoverRef.current = null;
      setPreview(null);
      setDots(null);
    };
  }, [args.armed]);

  return { preview, dots };
}
