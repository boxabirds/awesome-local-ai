/**
 * One arrow on the board: a line, a point at one end, and two ends that can be pulled somewhere else.
 *
 * An arrow is the only object here that has no place of its own. A note is where it is because somebody put
 * it there; this is where its two ends are, and its ends are wherever *other objects* happen to be. So most
 * of this file is about not holding a position: the line is asked of the document and the boxes of the
 * objects it joins, once per render, and there is nothing stored to fall out of date. Move a shape six
 * hundred units to the right and the arrow that pointed at it moves with it without a single write — which
 * is the whole reason an arrow is not stored as four numbers.
 *
 * Three decisions are worth naming:
 *
 * **The picture is SVG; everything you can press is a plain element.** An arrow is drawn with a stroke and a
 * wedge, which is SVG's job, but a shape's `pointer-events` in SVG are a thing of their own, with their own
 * coordinate rules and their own flakiness under a scaled root. So the drawing is marked invisible to the
 * pointer and the targets are HTML laid on top of it: a strip along the line for selecting the arrow, two
 * dots for its ends. A person clicking near an arrow hits a `div` the width of a pointer, and that is all
 * the click has ever needed to be.
 *
 * **The clickable strip is as thick as a pointer, not as a line.** The arrow is drawn 2 units thick, which
 * at ten per cent zoom is a fifth of a pixel and impossible to aim at. The strip is `CONNECTOR_HIT_TOLERANCE_PX`
 * *screen* pixels wide on either side, divided by the zoom to get world units, so an arrow is exactly as
 * easy to select at ten per cent as at four hundred. This is the same rule that keeps the resize handles the
 * size of a thumb.
 *
 * **Dragging an end writes once, at the end.** The frames in between are kept in local state and thrown
 * away: the arrow is drawn from the preview while the pointer travels, and the document is written once when
 * it stops. Writing each frame would put a change into the shared document for every mouse movement of a
 * re-attach, and every one of them except the last would be a place the arrow never ended up.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import { snapshot } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_COLOR,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HANDLE_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_REATTACH_RADIUS_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { attachableRects, isConnectorSnapshot, readConnector, setConnectorEndpoint } from '../../shared/objects/connector';
import type { ConnectorEnd } from '../../shared/objects/connector';
import type { ConnectorEnds, Side } from '../../shared/geometry/connector-geometry';
import {
  arrowLineEnd,
  arrowheadAttribute,
  arrowheadPoints,
  attachedEndpoint,
  connectorBBox,
  freeEndpoint,
  nearestSide,
  resolveEndpoints,
  sideAnchor,
} from '../../shared/geometry/connector-geometry';
import type { Point, Rect } from '../../shared/geometry';
import { rectContains } from '../../shared/geometry';
import type { ObjectProps } from './objectProps';

export type ConnectorObjectProps = ObjectProps;

/** The mouse button that picks an arrow up. */
const PRIMARY_MOUSE_BUTTON = 0;

/** How far a released end looks for an object to join, in world units at this zoom. */
function reachAt(zoom: number): number {
  return CONNECTOR_REATTACH_RADIUS_PX / (zoom > 0 ? zoom : 1);
}

/**
 * The object this point would attach to, and the side it would go on.
 *
 * The side is the one *nearest this point*, which is what makes an end released above an object land on its
 * top rather than on whichever side its centre happens to be nearest — a person aims at the side they can
 * see, and there are four to choose from. Among the objects that are close enough, the one whose anchor is
 * nearest wins, because two objects touching means two candidates and the arrow should point at the one it
 * was aimed at.
 *
 * The object the other end is already on is passed as `exclude`: an arrow from a shape to itself says
 * nothing, and the model would refuse the write anyway. Saying so here is what stops the highlight
 * promising an attachment that is never going to happen.
 */
export function attachTargetAt(
  rects: ReadonlyMap<string, Rect>,
  point: Point,
  zoom: number,
  exclude?: string,
): { objectId: string; side: Side; anchor: Point } | null {
  const reach = reachAt(zoom);
  let best: { objectId: string; side: Side; anchor: Point } | null = null;
  let bestDistance = Infinity;
  for (const [objectId, rect] of rects) {
    if (exclude !== undefined && objectId === exclude) continue;
    const side = nearestSide(rect, point);
    const anchor = sideAnchor(rect, side);
    // On top of the object counts as meaning it, however far the middle of the nearest side is: a shape two
    // screens wide has a point at its centre that is nowhere near any of its four sides, and a person standing
    // on it means it. Only a point that is *off* the object has to be within reach of a side.
    const distance = rectContains(rect, { x: point.x, y: point.y, width: 0, height: 0 })
      ? 0
      : Math.hypot(anchor.x - point.x, anchor.y - point.y);
    if (distance <= reach && distance < bestDistance) best = { objectId, side, anchor };
  }
  return best;
}

/**
 * Whether this point is on top of this object.
 *
 * This is for the one rejection an end drag has: an end cannot be pointed at the object the other end is
 * already on. That is not a reach question — it is the arrow saying it joins a thing to itself.
 */
function isOver(rects: ReadonlyMap<string, Rect>, point: Point, objectId: string): boolean {
  const rect = rects.get(objectId);
  return rect === undefined ? false : rectContains(rect, { x: point.x, y: point.y, width: 0, height: 0 });
}

/** An end being dragged: where the pointer is, and what it would join if it let go now. */
interface EndDrag {
  end: ConnectorEnd;
  point: Point;
  target: { objectId: string; side: Side; anchor: Point } | null;
  /**
   * Where the pointer went down, and where the end was at that moment.
   *
   * A drag is measured from these two rather than from where the browser says this element sits, for two
   * reasons that are the same reason. An arrow's wrapper moves while its end is being dragged — the box is
   * derived from its ends, so the box follows the pointer — and a position read against a moving ruler drifts.
   * And the pointer leaves the arrow, always: it is thin. The board already knows where the end is; the only
   * thing the pointer has to say is how far it has travelled.
   */
  start: { clientX: number; clientY: number; at: Point };
}

export function ConnectorObject(props: ConnectorObjectProps): JSX.Element {
  const { object, doc, zoom, selected, selectedCount, readOnly, interaction } = props;
  const scale = zoom > 0 ? zoom : 1;
  const [drag, setDrag] = useState<EndDrag | null>(null);
  const dragRef = useRef<EndDrag | null>(null);

  // The boxes an end can join. Read from the document when the board did not hand them over: an arrow that
  // cannot see the objects it joins cannot draw itself, so asking is not a fallback so much as the last
  // thing that could possibly work.
  const rects = props.rects ?? attachableRects(snapshot(doc));
  // The ends as this render sees them. The board's snapshot already carries them, resolved against the boxes
  // of the objects they are attached to; only an arrow drawn outside a board has to go and read its own
  // document.
  const connector = isConnectorSnapshot(object) ? object : readConnector(doc, object.id);

  const [dragging, setDragging] = useState(false);
  const held = dragRef.current;
  // The two points the arrow is drawn between, with the end being dragged shown at the pointer.
  const drawn = connector === null ? null : drawnEnds(connector, rects, held);
  const box = drawn === null ? null : connectorBBox(drawn.from, drawn.to);
  // Room for the wedge and for the pointer's aim, in world units: the strip that makes the arrow clickable
  // sticks out past the drawn line by a pointer's width, and the wrapper has to be big enough to hold it.
  const pad = CONNECTOR_ARROWHEAD_SIZE_WORLD + CONNECTOR_HIT_TOLERANCE_PX / scale;

  /** Where the pointer is on the board, measured from the start of this drag: see `EndDrag.start`. */
  const worldOf = useCallback(
    (event: { clientX: number; clientY: number }, held: EndDrag): Point => ({
      x: held.start.at.x + (event.clientX - held.start.clientX) / scale,
      y: held.start.at.y + (event.clientY - held.start.clientY) / scale,
    }),
    // Only the zoom is read, and it is read because a screen pixel is worth a different number of board
    // units at every zoom: the pointer's travel is divided by it, the same way a handle's size is.
    [scale],
  );

  // The pointer is only being followed while it is holding an end. The listeners are on the window, so a
  // drag that leaves the arrow — which it will, the arrow is thin — still reports where the pointer is and
  // still lets go properly.
  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: PointerEvent): void => {
      const heldNow = dragRef.current;
      if (heldNow === null) return;
      const point = worldOf(event, heldNow);
      const other = heldNow.end === 'from' ? connector?.to : connector?.from;
      dragRef.current = { ...heldNow, point, target: attachTargetAt(rects, point, scale, objectId(other)) };
      setDrag(dragRef.current);
    };

    const onUp = (event: PointerEvent): void => {
      const heldNow = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      setDrag(null);
      if (heldNow === null || connector === null) return;
      const point = worldOf(event, heldNow);
      const otherId = objectId(heldNow.end === 'from' ? connector.to : connector.from);
      // An end pointed at the object the other end sits on is refused, and the handle goes back to where it
      // came from. Nothing is written, so nothing has to be undone: the rejection happens before the
      // transaction, in the same place the pointer's journey ends.
      if (otherId !== undefined && isOver(rects, point, otherId)) return;
      const target = attachTargetAt(rects, point, scale, otherId);
      // One re-attach, one undo step, one message: the boundaries are what say that the pointer's whole
      // journey was one decision, and the arrow this person had was not being edited forty times.
      props.undo?.boundary();
      setConnectorEndpoint(
        doc,
        object.id,
        heldNow.end,
        target === null ? freeEndpoint(point) : attachedEndpoint(target.objectId, target.anchor),
      );
      props.undo?.boundary();
    };

    const onCancel = (): void => {
      // The pointer went away: the arrow goes back to where it was, because nothing was ever written.
      dragRef.current = null;
      setDragging(false);
      setDrag(null);
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
    };
  }, [dragging, scale, rects, connector, doc, object.id, props.undo]);
  /** An end's handle went down. Nothing is written yet; the arrow has only been told which end is being held. */
  const beginEndDrag = (end: ConnectorEnd) => (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (readOnly) {
      event.stopPropagation();
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    // The press is the end's, not the arrow's: pressing an end re-attaches it and does not select, move or
    // start anything on the object the end is currently sitting on.
    event.stopPropagation();
    const point = drawn === null ? undefined : drawn[end];
    if (point === undefined) return;
    // The drag is anchored to where this end is now, in board units, and to where the pointer went down.
    dragRef.current = { end, point, target: null, start: { clientX: event.clientX, clientY: event.clientY, at: point } };
    setDragging(true);
    setDrag(dragRef.current);
  };

  const showsHandles = selected && selectedCount === 1 && interaction !== 'dragging';

  if (connector === null || drawn === null || box === null) {
    // An arrow with nothing to draw itself between is still an object, and it is drawn as nothing rather
    // than as a guess. There is no message: an arrow whose objects have both been deleted has been deleted
    // itself a moment later, and the board will not be showing it either way.
    return <div className="connector-object" data-testid="connector-object" data-connector-id={object.id} />;
  }

  const strip = CONNECTOR_STROKE_WIDTH_WORLD + (2 * CONNECTOR_HIT_TOLERANCE_PX) / scale;
  const origin = { x: box.x - pad, y: box.y - pad };
  const size = { width: box.width + pad * 2, height: box.height + pad * 2 };
  const angle = (Math.atan2(drawn.to.y - drawn.from.y, drawn.to.x - drawn.from.x) * 180) / Math.PI;
  const length = Math.hypot(drawn.to.x - drawn.from.x, drawn.to.y - drawn.from.y);
  const tail = arrowLineEnd(drawn.from, drawn.to, CONNECTOR_ARROWHEAD_SIZE_WORLD);
  const handle = (CONNECTOR_HANDLE_RADIUS_PX * 2) / scale;
  const dot = (CONNECTOR_DOT_RADIUS_PX * 2) / scale;

  return (
    <div
      className="connector-object"
      role="group"
      aria-label="Connector"
      data-testid="connector-object"
      data-connector-id={object.id}
      data-connector-from={connector.from.kind}
      data-connector-to={connector.to.kind}
      data-selected={selected ? 'true' : 'false'}
      data-interaction={interaction}
      style={{
        left: origin.x,
        top: origin.y,
        width: size.width,
        height: size.height,
        zIndex: object.z,
      }}
    >
      <svg
        className="connector-object__svg"
        data-testid="connector-svg"
        width={size.width}
        height={size.height}
        viewBox={`${origin.x} ${origin.y} ${size.width} ${size.height}`}
        aria-hidden="true"
        focusable="false"
      >
        <line
          x1={drawn.from.x}
          y1={drawn.from.y}
          x2={tail.x}
          y2={tail.y}
          stroke={CONNECTOR_COLOR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        />
        <polygon
          points={arrowheadAttribute(arrowheadPoints(drawn.from, drawn.to, CONNECTOR_ARROWHEAD_SIZE_WORLD))}
          fill={CONNECTOR_COLOR}
        />
        {drag?.target ? (
          // Where this end would go, if the pointer let go here: the answer is shown before the question is
          // finished, which is what lets a person aim at a side rather than guess at one.
          <circle cx={drag.target.anchor.x} cy={drag.target.anchor.y} r={dot / 2} fill={CONNECTOR_COLOR} />
        ) : null}
      </svg>
      {/* The strip along the line: what a click is actually aiming at. */}
      <div
        className="connector-object__hit"
        data-testid="connector-hit"
        aria-hidden="true"
        style={{
          left: drawn.from.x - origin.x,
          top: drawn.from.y - origin.y,
          width: Math.max(length, 0.01),
          height: strip,
          transform: `translateY(-50%) rotate(${angle}deg)`,
        }}
        onPointerDown={(event) => {
          if (readOnly) {
            event.stopPropagation();
            return;
          }
          if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
          event.stopPropagation();
          props.onPointerDown(event, object.id);
        }}
      />
      {showsHandles
        ? (['from', 'to'] as const).map((end) => (
            <div
              key={end}
              role="button"
              className="connector-object__handle"
              data-testid={`connector-handle-${end}`}
              data-end={end}
              aria-label={end === 'from' ? 'Tail of the arrow' : 'Head of the arrow'}
              title={end === 'from' ? 'Drag to move the tail of this arrow' : 'Drag to point this arrow somewhere else'}
              style={{
                left: drawn[end].x - origin.x - handle / 2,
                top: drawn[end].y - origin.y - handle / 2,
                width: handle,
                height: handle,
              }}
              onPointerDown={beginEndDrag(end)}
            />
          ))
        : null}
    </div>
  );
}

/** The id an end is attached to, when it is attached to something. */
function objectId(end: { kind: string; objectId?: string } | undefined): string | undefined {
  return end?.kind === 'attached' ? end.objectId : undefined;
}

/**
 * The two points to draw, with a dragged end following the pointer.
 *
 * The resolved ends come from the geometry — every attached end at the middle of the side of its object that
 * faces the other end — and then the end being dragged is put where the pointer is instead. That is the only
 * change a drag makes to the picture: the other end stays where *its* object is, so the arrow pivots.
 */
function drawnEnds(
  connector: ConnectorEnds,
  rects: ReadonlyMap<string, Rect>,
  held: EndDrag | null,
): { from: Point; to: Point } {
  const resolved = resolveEndpoints({ from: connector.from, to: connector.to }, rects);
  if (held === null) return resolved;
  return { ...resolved, [held.end]: held.point } as { from: Point; to: Point };
}
