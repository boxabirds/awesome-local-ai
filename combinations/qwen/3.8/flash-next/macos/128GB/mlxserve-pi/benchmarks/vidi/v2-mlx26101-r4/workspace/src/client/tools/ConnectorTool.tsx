/**
 * The Connector tool: press on something, drag to something else, and an arrow is drawn between them.
 *
 * An arrow is a claim about two objects, so the tool spends almost all of its attention on objects — which
 * one is under the pointer, which of its four sides an end would go to, and whether the thing at the far end
 * is the same thing as the thing at the near one. The two questions the tool answers all the time are asked
 * of the shared geometry, never of a guess made here: which side faces this point, and where on that side the
 * arrow would land. That is what makes the preview the truth rather than an approximation of it — the dot
 * shown while the pointer travels is the same point the arrow is drawn to afterwards, produced by the same
 * function, because a preview that turns out to be a guess is how a person ends up aiming twice.
 *
 * Three behaviours are worth naming before the code:
 *
 * **The dots appear while hovering, before anything is committed.** Four of them, one per side, with the one
 * this pointer would use marked. They are a question put back to the person — *where would an arrow join
 * this object?* — asked at the moment they can still change their mind about the object.
 *
 * **An arrow that would say nothing is not drawn.** Back to the object it started on, or shorter than
 * `CONNECTOR_MIN_LENGTH_WORLD`, and nothing is created and nothing is said. The tool stays armed, because a
 * person who meant to draw an arrow and got none has already decided to draw one and will simply drag again.
 * The model refuses these too, so this is not a second rule; it is the same rule noticed early enough that no
 * undo step is wasted on it.
 *
 * **One end on an object, one end on an object, and a fallback for each.** Both ends are stored with the
 * point they should be drawn at if the object on them stops existing, so an arrow whose object is deleted in
 * the next second by somebody else is still an arrow that can be drawn, selected and deleted.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import type { ObjectSnapshot } from '../../shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_REATTACH_RADIUS_PX } from '../../shared/config';
import { attachableRects, createConnector } from '../../shared/objects/connector';
import type { Side } from '../../shared/geometry/connector-geometry';
import {
  SIDES,
  arrowheadAttribute,
  arrowheadPoints,
  nearestSide,
  sideAnchor,
} from '../../shared/geometry/connector-geometry';
import type { Point, Rect } from '../../shared/geometry';
import { rectContains } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { toolOverlayStyle, toolOverlaySvgStyle, worldOfOverlay } from './toolOverlay';

/** The mouse button that draws. */
const PRIMARY_MOUSE_BUTTON = 0;

/** How long the arrowhead of a preview is, in screen pixels. */
const PREVIEW_ARROWHEAD_PX = 9;

export interface ConnectorToolProps {
  /** The board to draw on. Written to through the model, never directly. */
  doc: Y.Doc;
  /** Everything on the board, for deciding what the pointer is pointing at. */
  objects: readonly ObjectSnapshot[];
  /** The camera this frame is drawn with. */
  camera: Camera;
  /** An arrow was made: select it, and the tool is done. */
  onCreated(id: string): void;
}

/** The object under this point that has the highest stacking number, with the box that was hit. */
function objectAt(
  rects: ReadonlyMap<string, Rect>,
  objects: readonly ObjectSnapshot[],
  point: Point,
): { id: string; rect: Rect } | null {
  let best: { id: string; rect: Rect; z: number } | null = null;
  for (const [id, box] of rects) {
    if (!rectContains(box, { x: point.x, y: point.y, width: 0, height: 0 })) continue;
    const object = objects.find((candidate) => candidate.id === id);
    const z = object?.z ?? 0;
    if (best === null || z >= best.z) best = { id, rect: box, z };
  }
  return best === null ? null : { id: best.id, rect: best.rect };
}

/** What the pointer is pointing at, as far as arrows are concerned: an object, and the side it faces. */
interface Hover {
  id: string;
  rect: Rect;
  side: Side;
  anchor: Point;
}

/**
 * The object under the pointer and the side of it an end would join.
 *
 * Directly on top: the side nearest this point, which is why an arrow aimed at the top of a shape comes out
 * of its top and not its middle. Near it but not on it: the nearest side, as long as that side's anchor is
 * within `CONNECTOR_REATTACH_RADIUS_PX` *screen* pixels — the generosity an end being dropped onto an object
 * needs, because a person means the object and not the pixel.
 */
function hoverAt(hovered: { id: string; rect: Rect } | null, point: Point, zoom: number): Hover | null {
  if (hovered === null) return null;
  const side = nearestSide(hovered.rect, point);
  const anchor = sideAnchor(hovered.rect, side);
  const scale = zoom > 0 ? zoom : 1;
  const reach = CONNECTOR_REATTACH_RADIUS_PX / scale;
  if (!rectContains(hovered.rect, { x: point.x, y: point.y, width: 0, height: 0 })) {
    // Off the object: close enough to its nearest side to still mean it, or aiming at board.
    if (Math.hypot(anchor.x - point.x, anchor.y - point.y) > reach) return null;
  }
  return { id: hovered.id, rect: hovered.rect, side, anchor };
}

export function ConnectorTool({ doc, objects, camera, onCreated }: ConnectorToolProps): JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null);
  // What the pointer is over, for the dots; and the arrow being drawn, which is nothing until a press starts.
  const [hover, setHover] = useState<Hover | null>(null);
  const [drawing, setDrawing] = useState<{ from: Point; to: Point } | null>(null);
  const press = useRef<{ pointerId: number; at: Point; id: string | null } | null>(null);

  // The boxes an end can join, once per render of the board's object list. The same map the objects are drawn
  // with, so the tool and the arrow cannot disagree about which objects have surfaces — and neither of them
  // gets to decide separately that a connector's own box, which is derived and may be zero-wide, is not a
  // surface an arrow can land on.
  const rects = useMemo(() => attachableRects(objects), [objects]);

  const worldOf = (event: { clientX: number; clientY: number }): Point => worldOfOverlay(overlayRef, camera, event);

  /** The object the pointer means at this point, ignoring the one the arrow already starts on. */
  const targetAt = (point: Point, exclude: string | null): Hover | null => {
    const direct = objectAt(rects, objects, point);
    const candidate = direct !== null && direct.id !== exclude ? direct : nearestRectTo(rects, point, exclude);
    return hoverAt(candidate, point, camera.zoom);
  };

  // The press handlers read the current board out of a ref rather than out of the closure they were created
  // in. The listeners are put on the window for as long as a drag is held, and a drag can outlive the render
  // that started it — an object created while the pointer is travelling, a zoom from the wheel — and a
  // closure holding last frame's objects would hit-test against a board that no longer exists.
  const latest = useRef({ targetAt });
  latest.current.targetAt = targetAt;

  const begin = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    // The press is the arrow's. Nothing underneath it is told: a note with an arrow drawn across it stays
    // exactly where it was, and does not even become the selection.
    event.stopPropagation();
    const at = worldOf(event);
    const started = objectAt(rects, objects, at);
    press.current = { pointerId: event.pointerId, at, id: started?.id ?? null };
    setDrawing({ from: at, to: at });
  };

  // Moves and releases on the window, for as long as a press is held: the pointer leaves the sheet's centre,
  // crosses the toolbar and lets go over the status badge, and the arrow still has to be drawn to where it
  // actually stopped.
  useEffect(() => {
    if (drawing === null) return;

    const onMove = (event: PointerEvent): void => {
      const pressed = press.current;
      if (pressed === null || event.pointerId !== pressed.pointerId) return;
      const point = worldOf(event);
      setDrawing({ from: pressed.at, to: point });
      setHover(latest.current.targetAt(point, pressed.id));
    };

    const onUp = (event: PointerEvent): void => {
      const pressed = press.current;
      press.current = null;
      setDrawing(null);
      setHover(null);
      if (pressed === null || event.pointerId !== pressed.pointerId) return;

      const point = worldOf(event);
      const target = latest.current.targetAt(point, pressed.id);
      // An arrow from an object back onto itself says nothing about the board, and an arrow shorter than a
      // deliberate drag is a click that wobbled. The model refuses both; stopping here is the same answer
      // given before a transaction is opened for it, so a refusal does not cost an undo step.
      if (target !== null && target.id === pressed.id) return;
      if (target === null && Math.hypot(point.x - pressed.at.x, point.y - pressed.at.y) < 1) return;

      // The end that started on an object is attached to it, at the side that faces where the arrow is going
      // — which is the side the arrow will be drawn to from, so the stored fallback and the drawing agree.
      const fromRect = pressed.id === null ? undefined : rects.get(pressed.id);
      const from =
        pressed.id !== null && fromRect !== undefined
          ? { kind: 'attached' as const, objectId: pressed.id, fallback: sideAnchor(fromRect, nearestSide(fromRect, point)) }
          : { kind: 'free' as const, x: pressed.at.x, y: pressed.at.y };
      const to =
        target === null
          ? { kind: 'free' as const, x: point.x, y: point.y }
          : { kind: 'attached' as const, objectId: target.id, fallback: target.anchor };

      const id = createConnector(doc, from, to, String(doc.clientID));
      // Created: the arrow is the selection and the tool steps aside. Refused: the tool is still armed, and
      // the next drag is the same drag this person meant to make.
      if (id !== null) onCreated(id);
    };

    const onCancel = (): void => {
      press.current = null;
      setDrawing(null);
      setHover(null);
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
    };
  }, [camera, doc, objects, onCreated, drawing === null]);

  // Hovering, with nothing pressed: the four sides of whatever is under the pointer, one of them marked.
  // This is the tool asking *would an arrow join here?* at the moment there is still time to move.
  const onHoverMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (press.current !== null) return;
    const point = worldOf(event);
    setHover(hoverAt(objectAt(rects, objects, point), point, camera.zoom));
  };

  const onHoverLeave = (): void => {
    if (press.current !== null) return;
    setHover(null);
  };

  // Everything the sheet draws is in screen units: a preview is shown at the size the person is looking at
  // the board at, and does not grow and shrink as the board is zoomed while it is being drawn.
  const screen = (point: Point): Point => worldToScreen(camera, point);
  const preview = drawing === null ? null : { from: screen(drawing.from), to: screen(drawing.to) };
  const dots = hover === null ? [] : SIDES.map((side) => ({ side, at: screen(sideAnchor(hover.rect, side)) }));

  return (
    <div
      ref={overlayRef}
      className="tool-overlay tool-overlay--connector"
      data-testid="connector-tool"
      style={toolOverlayStyle}
      onPointerDown={begin}
      onPointerMove={onHoverMove}
      onPointerLeave={onHoverLeave}
    >
      <svg className="tool-overlay__svg" data-testid="connector-overlay-svg" style={toolOverlaySvgStyle} aria-hidden="true">
        {dots.map((dot) => (
          <circle
            key={dot.side}
            className="tool-overlay__dot"
            data-testid={`connector-dot-${dot.side}`}
            data-side={dot.side}
            data-nearest={hover !== null && hover.side === dot.side ? 'true' : 'false'}
            cx={dot.at.x}
            cy={dot.at.y}
            r={CONNECTOR_DOT_RADIUS_PX}
          />
        ))}
        {preview === null ? null : (
          <g data-testid="connector-preview">
            <line
              className="tool-overlay__preview-line"
              x1={preview.from.x}
              y1={preview.from.y}
              x2={preview.to.x}
              y2={preview.to.y}
            />
            <polygon
              className="tool-overlay__preview-head"
              points={arrowheadAttribute(arrowheadPoints(preview.from, preview.to, PREVIEW_ARROWHEAD_PX))}
            />
          </g>
        )}
      </svg>
    </div>
  );
}

/**
 * The box nearest this point, among the ones it is not already attached to.
 *
 * Only needed when the pointer is not on top of anything: on top of an object, that object is the candidate
 * and there is nothing to search. It returns the box, and leaves `hoverAt` to decide whether the point is
 * close enough to that box's nearest side to mean it — the distance question is asked in one place, in screen
 * units, and is not answered twice with two different tolerances.
 */
function nearestRectTo(
  rects: ReadonlyMap<string, Rect>,
  point: Point,
  exclude: string | null,
): { id: string; rect: Rect } | null {
  let best: { id: string; rect: Rect } | null = null;
  let bestDistance = Infinity;
  for (const [id, rect] of rects) {
    if (exclude !== null && id === exclude) continue;
    const anchor = sideAnchor(rect, nearestSide(rect, point));
    const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y);
    if (distance < bestDistance) {
      best = { id, rect };
      bestDistance = distance;
    }
  }
  return best;
}
