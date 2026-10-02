// Dragging one end of a selected arrow somewhere else: onto another shape, or out
// into the air.
//
// The gesture belongs to the two handles the selection draws over an arrow's ends,
// and it is written once, at the end of the drag, rather than on every frame of
// it. That is what makes an arrow follow a shape at all: an end that was written
// on every move would be an end that had to be re-aimed by whoever moved the shape,
// and the whole point of storing a reference is that nobody has to.
//
// Where the end lands is decided by the same hit test the Connector tool uses, so
// an end dragged onto a shape fastens to the shape a click would have picked; and
// whether the model takes the answer is the model's, which is why an end dropped
// on the shape the other end already belongs to goes back where it came from: the
// model refuses it, writes nothing, and there is nothing here to undo.

import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import type { ConnectorEnd, ConnectorEndpoint } from '../../shared/objects/connector';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import { nearestSide, sideAnchor } from '../../shared/geometry/connector-geometry';
import { screenToWorld, type Camera } from '../canvas/camera';
import type { UndoController } from '../board/undo';
import { attachTargetAt, rectsOf, type ConnectorDrag } from './useConnectorTool';

export interface ConnectorEndDragOptions {
  doc: Y.Doc;
  camera: Camera;
  /** What is on the board, which is where the arrow's two ends are read from. */
  objects: readonly ObjectSnapshot[];
  canEdit: boolean;
  undo?: UndoController;
}

export interface ConnectorEndDragResult {
  /** The end in flight, in board units, for the preview to be drawn from. */
  drag: ConnectorDrag | null;
  onEndPointerDown(e: ReactPointerEvent<Element>, id: string, end: ConnectorEnd): void;
  onEndPointerMove(e: ReactPointerEvent<Element>): void;
  onEndPointerUp(e: ReactPointerEvent<Element>): void;
  onEndPointerCancel(e: ReactPointerEvent<Element>): void;
}

/** A handle in flight: which arrow, which of its ends, and where its finger is. */
interface Held {
  id: string;
  end: ConnectorEnd;
  pointerId: number;
  /** The other end, fixed, so the drag has something to be measured against. */
  anchor: Point;
  /** The object the other end is fastened to, which this one may not be. */
  otherObjectId: string | null;
}

export function useConnectorEndDrag(options: ConnectorEndDragOptions): ConnectorEndDragResult {
  const [drag, setDrag] = useState<ConnectorDrag | null>(null);
  const opts = useRef(options);
  const held = useRef<Held | null>(null);

  useLayoutEffect(() => {
    opts.current = options;
  });

  const worldOf = (e: { clientX: number; clientY: number }): Point | null => {
    const base = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
    if (base === null) return null;
    const rect = base.getBoundingClientRect();
    return screenToWorld(opts.current.camera, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const onEndPointerDown = (e: ReactPointerEvent<Element>, id: string, end: ConnectorEnd): void => {
    if (opts.current.canEdit === false) return;
    const object = findConnector(opts.current.objects, id);
    if (object === null) return;
    const anchor = end === 'from' ? object.resolved.to : object.resolved.from;
    const other = end === 'from' ? object.to : object.from;
    held.current = {
      id,
      end,
      pointerId: e.pointerId,
      anchor,
      otherObjectId: other.kind === 'attached' ? other.objectId : null,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
    setDrag({ from: anchor, to: object.resolved[end], targetId: null, targetSide: null });
  };

  const onEndPointerMove = (e: ReactPointerEvent<Element>): void => {
    const going = held.current;
    if (going === null || e.pointerId !== going.pointerId) return;
    // The drag is an end moving, not a board moving and not a shape moving.
    e.stopPropagation();
    const at = worldOf(e);
    if (at === null) return;
    const current = opts.current;
    const target = attachTargetAt(current.objects, at, current.camera.zoom);
    const over = target !== null && target.id !== going.otherObjectId ? target : null;
    setDrag({
      from: going.anchor,
      to: at,
      targetId: over === null ? null : over.id,
      targetSide: over === null ? null : nearestSide(objectBounds(over), at),
    });
  };

  const finish = (e: ReactPointerEvent<Element>, cancelled: boolean): void => {
    const going = held.current;
    held.current = null;
    if (going === null || e.pointerId !== going.pointerId) return;
    e.stopPropagation();
    setDrag(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (cancelled) return;

    const at = worldOf(e);
    if (at === null) return;
    const current = opts.current;
    const target = attachTargetAt(current.objects, at, current.camera.zoom);
    const end: ConnectorEndpoint = endpointFor(target === null ? null : target.id, at, going.anchor, current.objects);

    current.undo?.boundary();
    // One end, one step of mine: the arrow, the box it is drawn in and the side
    // it now takes all come back together with one Undo.
    setConnectorEndpoint(current.doc, going.id, going.end, end);
    current.undo?.boundary();
  };

  return {
    drag,
    onEndPointerDown,
    onEndPointerMove,
    onEndPointerUp: (e) => {
      finish(e, false);
    },
    onEndPointerCancel: (e) => {
      finish(e, true);
    },
  };
}

/** The end being let go: fastened to the object it was dropped on, at the anchor
 *  of the side of it that faces the other end; or free, at the point it was let
 *  go at. Which objects have boxes to be fastened to is the board's business, so
 *  the boxes are looked up in the snapshot the board is drawn from. */
export function endpointFor(
  objectId: string | null,
  at: Point,
  otherEnd: Point,
  objects: readonly ObjectSnapshot[],
): ConnectorEndpoint {
  if (objectId === null) return { kind: 'free', x: at.x, y: at.y };
  const rect = rectsOf(objects).get(objectId);
  if (rect === undefined) return { kind: 'free', x: at.x, y: at.y };
  return { kind: 'attached', objectId, fallback: sideAnchor(rect, nearestSide(rect, otherEnd)) };
}

function findConnector(objects: readonly ObjectSnapshot[], id: string): Extract<ObjectSnapshot, { type: 'connector' }> | null {
  const object = objects.find((entry) => entry.id === id);
  return object !== undefined && object.type === 'connector' ? object : null;
}
