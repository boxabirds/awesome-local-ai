// One arrow on the board (story 10): a line between two ends, each of which is
// either attached to an object or fixed at a board point.
//
// What makes an arrow different from every other object here is that it has no
// place of its own. Its two ends are stored - one as an object and the point of
// that object's nearest side it was drawn at, one as a point - and where the arrow
// is drawn is worked out from where those objects are NOW, every time the board is
// drawn. So:
//
//   - anyone moving a shape moves the arrow with it, in the same render the move
//     arrives in, with nothing written about the arrow at all;
//   - an end whose object was deleted stays where it was drawn, because the point
//     it stored is the only thing left to draw it from;
//   - dragging the arrow itself moves nothing, which is why the line is clickable
//     but not grabbable, and why the only handles on it are its two ends.
//
// The line is the hit area, not its box: a click inside the box but farther than
// CONNECTOR_HIT_TOLERANCE_PX from the line belongs to the board, exactly as if the
// arrow were not there.

import {
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  DEFAULT_SHAPE_STROKE,
  HANDLE_SIZE_PX,
  SHAPE_STROKE_COLORS,
} from '../../shared/config';
import { screenToWorld } from '../canvas/camera';
import { useBoardCamera } from '../canvas/CameraProvider';
import {
  dropEndpointOn,
  setConnectorEndpoint,
  type ConnectorEnd,
  type ConnectorSnapshot,
  type Endpoint,
} from '../../shared/objects/connector';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { Point, Rect } from '../../shared/geometry';
import type { StickyNoteProps } from './StickyNote';

/** The arrow's colour: the same dark outline every shape is drawn with. */
const ARROW_COLOUR = SHAPE_STROKE_COLORS[DEFAULT_SHAPE_STROKE];

/**
 * An arrow takes the props every object takes and names its own snapshot in `note`
 * (the design's `connector`). It is given no rects map of its own: the snapshot it is
 * handed has its ends resolved already, by the same function, against the current
 * document, and the document changes as a shape is dragged - see the note on `ends`.
 * An arrow edits no text and opens no editor, so it takes no edit callbacks.
 */
export type ConnectorObjectProps = Omit<
  StickyNoteProps,
  'note' | 'single' | 'onStartEdit' | 'onFocusNote' | 'onEndEdit'
> & {
  note: ConnectorSnapshot;
};

/** The two ends of an arrow, in the order the board draws their handles. */
const ENDS = ['from', 'to'] as const;

/** The word a handle's accessible name uses for its end. */
const END_NAMES: Readonly<Record<ConnectorEnd, string>> = { from: 'start', to: 'end' };

/** An end that is being dragged, in board units, with the pointer dragging it. */
interface EndDrag {
  pointerId: number;
  end: ConnectorEnd;
  x: number;
  y: number;
}

export function ConnectorObject({
  note,
  doc,
  zoom,
  selected,
  editing,
  editable,
  onSelect,
}: ConnectorObjectProps): JSX.Element {
  const { camera } = useBoardCamera();
  /** The end being dragged, or null. Local state: no one else sees a handle drag. */
  const [drag, setDrag] = useState<EndDrag | null>(null);
  const dragRef = useRef<EndDrag | null>(null);

  // Where the ends are, straight out of the snapshot. That is not a stale value: the
  // snapshot is read from the document whenever the document changes, and a drag writes
  // to the document on every move - which is the whole reason an arrow follows a shape
  // another person dragged, and follows this person's own drag as it goes.
  const ends = note.ends;
  // While a handle is dragged, that end is drawn at the pointer and nothing else
  // moves: the other end keeps the side it faces, so the arrow is live.
  const from = drag !== null && drag.end === 'from' ? { x: drag.x, y: drag.y } : ends.from;
  const to = drag !== null && drag.end === 'to' ? { x: drag.x, y: drag.y } : ends.to;

  // The box the drawing lives in: the two ends with room round them for the click
  // tolerance, so a straight-up-or-across arrow is never clipped by its own box.
  const pad = (CONNECTOR_HIT_TOLERANCE_PX / zoom) * 2;
  const box: Rect = {
    x: Math.min(from.x, to.x) - pad,
    y: Math.min(from.y, to.y) - pad,
    width: Math.abs(to.x - from.x) + pad * 2,
    height: Math.abs(to.y - from.y) + pad * 2,
  };

  /** Where the pointer is on the board. */
  const worldOf = (event: { clientX: number; clientY: number }): Point =>
    screenToWorld(camera, { x: event.clientX, y: event.clientY });

  /** Is this board point on this arrow's line? Six screen pixels, whatever the zoom. */
  const onLine = (point: Point): boolean =>
    distanceToPolyline([ends.from, ends.to], point) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;

  const onPointerDown = (event: ReactPointerEvent<SVGLineElement>): void => {
    if (!editable) return; // a board that could not be read takes no gestures at all
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Inside the box is not on the arrow: the press is left to the board, which
    // pans, or clears its selection, exactly as it would with nothing here.
    if (!onLine(worldOf(event))) return;
    // The arrow owns this press: the board neither pans nor deselects.
    event.stopPropagation();
    onSelect(note.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<SVGLineElement>): void => {
    if (!onLine(worldOf(event))) return;
    // An arrow has no text to edit, so the double-click is the arrow's and the
    // board is not asked to drop a new note on top of the line.
    event.stopPropagation();
  };

  // --- one end handle: the only thing on an arrow that can be dragged. ----------

  /** The end this drop makes, or null when the model will not have it. */
  const dropEnd = (end: ConnectorEnd, point: Point): Endpoint | null =>
    dropEndpointOn(doc, { from: note.from, to: note.to }, end, point);

  const beginDrag = (end: ConnectorEnd) => (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!editable) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // The handle owns the press: no pan, no selection change, and no grab of the
    // object this handle happens to be lying on top of.
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = worldOf(event);
    dragRef.current = { pointerId: event.pointerId, end, x: point.x, y: point.y };
    setDrag({ pointerId: event.pointerId, end, x: point.x, y: point.y });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    const point = worldOf(event);
    dragRef.current = { ...current, x: point.x, y: point.y };
    setDrag(dragRef.current);
  };

  const finishDrag = (end: ConnectorEnd) => (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current;
    if (current === null || event.pointerId !== current.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    setDrag(null);
    // An end dropped on empty board is a point on the board; dropped on an object it
    // joins that object's facing side; and dropped on the object the other end is
    // already on it is refused, which writes nothing - so the end goes back to the
    // side it came from rather than to wherever the pointer happened to be.
    const next = dropEnd(end, worldOf(event));
    if (next !== null) setConnectorEndpoint(doc, note.id, end, next);
  };

  /** A drag let go of by the system - released off-window, interrupted - draws
   * nothing and changes nothing: the end keeps the place it had. */
  const cancelDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current === null || event.pointerId !== dragRef.current.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    setDrag(null);
  };

  /** The handle's size in board units, so it stays HANDLE_SIZE_PX on screen. */
  const handle = HANDLE_SIZE_PX / zoom;
  /** The click target's thickness in board units: the tolerance on both sides. */
  const hit = (CONNECTOR_HIT_TOLERANCE_PX / zoom) * 2;
  const head = `connector-head-${note.id}`;

  return (
    <div
      className="connector-object"
      data-testid="connector-object"
      data-connector-id={note.id}
      data-editable={editable}
      data-selected={selected}
      data-editing={editing}
      data-arrow-from-x={from.x}
      data-arrow-from-y={from.y}
      data-arrow-to-x={to.x}
      data-arrow-to-y={to.y}
      data-from-kind={note.from.kind}
      data-to-kind={note.to.kind}
      style={
        {
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          // Stacking is each object's own business, the note's and the shape's rule.
          zIndex: note.z,
        } as CSSProperties
      }
    >
      <svg
        className="connector-svg"
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        width={box.width}
        height={box.height}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          {/* The head is this long and this wide, in board units, whatever the
              line's thickness - so zooming grows it as much as it grows the object
              it points at. */}
          <marker
            id={head}
            markerUnits="userSpaceOnUse"
            markerWidth={CONNECTOR_ARROWHEAD_SIZE_WORLD * 2}
            markerHeight={CONNECTOR_ARROWHEAD_SIZE_WORLD * 2}
            refX={CONNECTOR_ARROWHEAD_SIZE_WORLD * 2}
            refY={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            orient="auto"
          >
            <polygon
              className="connector-head"
              points={`0,0 ${CONNECTOR_ARROWHEAD_SIZE_WORLD * 2},${CONNECTOR_ARROWHEAD_SIZE_WORLD} 0,${CONNECTOR_ARROWHEAD_SIZE_WORLD * 2}`}
              fill={ARROW_COLOUR}
            />
          </marker>
        </defs>
        {/* The line you click: as thick as the tolerance, and invisible. It is the
            only part of this box that takes a pointer, which is what lets a click
            beside the arrow through to the board. */}
        <line
          className="connector-hit"
          data-testid="connector-hit"
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          strokeWidth={hit}
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
        />
        <line
          className="connector-line"
          data-testid="connector-line"
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          markerEnd={`url(#${head})`}
        />
        {drag === null ? null : (
          // what the end you are dragging would become: a line to the pointer
          <line
            className="connector-drag-preview"
            data-testid="connector-drag-preview"
            x1={ends.from.x}
            y1={ends.from.y}
            x2={drag.end === 'from' ? drag.x : ends.to.x}
            y2={drag.end === 'from' ? drag.y : ends.to.y}
            strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          />
        )}
      </svg>
      {selected && editable
        ? ENDS.map((end) => {
            const point = end === 'from' ? from : to;
            return (
              <div
                key={end}
                className={`connector-end connector-end--${end}`}
                data-testid={`connector-end-${end}`}
                data-end={end}
                data-end-x={point.x}
                data-end-y={point.y}
                role="button"
                aria-label={`Arrow ${END_NAMES[end]}`}
                tabIndex={-1}
                style={
                  {
                    // The box is drawn in board units and the world layer scales it,
                    // so a handle is placed in board units and sized in screen pixels
                    // over the zoom: HANDLE_SIZE_PX on the screen at every zoom, the
                    // selection overlay's rule for the same reason.
                    left: `${point.x - box.x - handle / 2}px`,
                    top: `${point.y - box.y - handle / 2}px`,
                    width: `${handle}px`,
                    height: `${handle}px`,
                  } as CSSProperties
                }
                onPointerDown={beginDrag(end)}
                onPointerMove={moveDrag}
                onPointerUp={finishDrag(end)}
                onPointerCancel={cancelDrag}
                onLostPointerCapture={cancelDrag}
              />
            );
          })
        : null}
    </div>
  );
}
