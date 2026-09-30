// Drawing an arrow between two things (`connector.create`, `connector.ui`).
//
// The tool is an invisible sheet over the board while the connector tool is the active
// one. What it asks you, twice with your pointer, is *what does this arrow start at* and
// *what does it end at*. Everything else follows from asking it that way:
//
//   - **You aim at objects, not at pixels.** While you drag, the object under the pointer
//     is found by its box, and the four dots that appear on it are the four places an end
//     may attach to — the real anchors, worked out with the same `resolveEndpoints` and
//     `sideAnchor` that draw every arrow on the board, so a dot never sits where an arrow
//     would not have gone.
//
//   - **The ends are what gets stored, and only at the end.** The preview line and the
//     dots are this screen's business; one `createConnector` call writes the document
//     once, as one undo step. Where an arrow's box is, which side of each object it lands
//     on and how far the line is shortened are the model's answers, given again on every
//     screen for as long as the arrow lives.
//
//   - **An arrow from a thing to itself is not a thing.** Releasing on the object the
//     drag started on creates nothing at all and leaves the tool up (TC-26): the model
//     refuses it, and the tool does not pretend otherwise.
//
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
import {
  useEffect,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import type * as Y from 'yjs';
import type { BoardObject } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_COLOR,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { rectContains } from '../../shared/geometry';
import {
  SIDES,
  nearestSide,
  resolveEndpoints,
  shortenSegment,
  sideAnchor,
  type Endpoint,
  type Side,
} from '../../shared/geometry/connector-geometry';
import { unitDirection } from '../../shared/geometry/polyline';
import { createConnector, isConnectorSnapshot } from '../../shared/objects/connector';
import { arrowheadPoints } from '../objects/ConnectorObject';
import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { UndoController } from '../board/undo';

export interface ConnectorToolProps {
  doc: Y.Doc;
  camera: Camera;
  /** Everything on the board, the same snapshot the board itself is drawn from. */
  snapshot: readonly BoardObject[];
  /** The arrow is in the document; the board selects it and the tool goes back. */
  onCreated(id: string): void;
  /** Escape, with nothing drawn: back to the select tool. */
  onCancelled(): void;
  /** This tab's undo history; the arrow is one step. */
  undo?: UndoController;
}

export function ConnectorTool({ doc, camera, snapshot, onCreated, onCancelled, undo }: ConnectorToolProps): ReactNode {
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null);
  // The object the pointer is over with no drag going on: the one whose sides are shown
  // as the places an end could go (`connector.hover_points`).
  const [hover, setHover] = useState<string | null>(null);
  // Only the things an arrow may be attached to: an arrow does not join arrows.
  const attachable = snapshot.filter((object) => !isConnectorSnapshot(object));
  const rects = boxesOf(attachable);

  const world = (event: ReactPointerEvent<HTMLDivElement>): Point =>
    screenToWorld(camera, { x: event.clientX, y: event.clientY });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    // Nothing under this sheet pans, marquees or clears a selection.
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const at = world(event);
    setHover(null);
    setDrag({ from: at, to: at });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag === null) {
      // Nothing is being drawn, so the pointer is only asking a question: what would an
      // end attach to here? The answer is the object under it, and its four sides.
      setHover(objectUnder(attachable, world(event))?.id ?? null);
      return;
    }
    event.stopPropagation();
    setDrag({ from: drag.from, to: world(event) });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag === null) return;
    event.stopPropagation();
    const ends = endsFor(drag.from, world(event), attachable);
    setDrag(null);
    setHover(null);
    undo?.boundary();
    const id = createConnector(doc, ends.from, ends.to, '');
    undo?.boundary();
    // Nothing was made — the drag began and ended on one object, or was too short to be
    // an arrow — so nothing is selected, the tool stays up and the board is unchanged.
    if (id === null) return;
    onCreated(id);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setDrag(null);
      onCancelled();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancelled]);

  // The pointer leaving the sheet leaves the dots with it: they belong to where it is.
  const onPointerLeave = (): void => {
    if (drag === null) setHover(null);
  };

  // What the drag looks like, in the screen's own pixels; nothing when no drag is on.
  const preview = drag === null ? null : previewOf(drag, attachable, rects, camera);
  // And what it shows when the pointer is only resting over something: that object's four
  // sides, none of them chosen yet.
  const hoverDots =
    drag === null && hover !== null ? dotsFor(rects.get(hover) ?? null, camera, null) : [];

  return (
    <div
      data-testid="connector-tool"
      aria-label="Drawing an arrow"
      style={sheetStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerLeave={onPointerLeave}
    >
      {preview ? (
        // No viewBox: the sheet's own user units are CSS pixels, which is exactly the
        // space the preview is worked out in.
        <svg
          data-testid="connector-tool-preview"
          style={svgStyle}
          focusable="false"
          aria-hidden="true"
        >
          <line
            data-testid="connector-tool-line"
            x1={preview.line[0].x}
            y1={preview.line[0].y}
            x2={preview.line[1].x}
            y2={preview.line[1].y}
            stroke={CONNECTOR_COLOR}
            strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD * camera.zoom}
            strokeLinecap="round"
            // The arrow is not in the document yet, and this is this screen's drawing of
            // what it will be.
            strokeDasharray="5 4"
          />
          <polygon data-testid="connector-tool-arrowhead" points={preview.head} fill={CONNECTOR_COLOR} />
          {preview.dots.map(dotCircle)}
        </svg>
      ) : (
        // No drag on: the dots belong to the object the pointer is resting over, and they
        // say where an end would go rather than where one is going.
        hoverDots.length > 0 ? (
          <svg data-testid="connector-tool-dots" style={svgStyle} focusable="false" aria-hidden="true">
            {hoverDots.map(dotCircle)}
          </svg>
        ) : null
      )}
    </div>
  );
}

/**
 * Where an arrow would go, given where its drag started and where it ended: whatever is
 * under each end becomes the object that end is attached to, and whatever is not becomes
 * a point on the board. Whether the two may be joined at all is the model's question, not
 * this function's.
 */
export function endsFor(
  from: Point,
  to: Point,
  attachable: readonly BoardObject[],
): { from: Endpoint; to: Endpoint } {
  const start = objectUnder(attachable, from);
  const finish = objectUnder(attachable, to);
  return {
    from: start ? { kind: 'attached', objectId: start.id } : { kind: 'free', x: from.x, y: from.y },
    to: finish ? { kind: 'attached', objectId: finish.id } : { kind: 'free', x: to.x, y: to.y },
  };
}

/** The topmost object whose box contains a point — the one an end would attach to. */
export function objectUnder(
  attachable: readonly BoardObject[],
  point: Point,
): BoardObject | null {
  // The same rule the marquee draws by, so an arrow attaches to the thing a drag of the
  // same box would have selected: the one on top of the others.
  const box: Rect = { x: point.x, y: point.y, width: 0, height: 0 };
  let best: BoardObject | null = null;
  for (const object of attachable) {
    if (!rectContains(objectBounds(object), box)) continue;
    if (best === null || object.z >= best.z) best = object;
  }
  return best;
}

/** Every box on the board, by object id. */
const boxesOf = (objects: readonly BoardObject[]): Map<string, Rect> => {
  const rects = new Map<string, Rect>();
  for (const object of objects) rects.set(object.id, objectBounds(object));
  return rects;
};

/** What the tool shows while a drag is going on, in screen pixels. */
interface Preview {
  line: [Point, Point];
  head: string;
  dots: Dot[];
}

/** One connection point on the sheet, and whether the arrow would take it. */
interface Dot {
  side: Side;
  screen: Point;
  active: boolean;
}

/**
 * The preview of an arrow in progress. The sides, the anchors and the shortening all
 * come from `resolveEndpoints`, the same function that draws every arrow on every screen,
 * so what you see while you drag is what you get when you let go.
 */
function previewOf(
  drag: { from: Point; to: Point },
  attachable: readonly BoardObject[],
  rects: ReadonlyMap<string, Rect>,
  camera: Camera,
): Preview {
  const ends = endsFor(drag.from, drag.to, attachable);
  const resolved = resolveEndpoints(ends, rects);
  const direction = unitDirection(resolved.from, resolved.to);
  const length = Math.hypot(resolved.to.x - resolved.from.x, resolved.to.y - resolved.from.y);
  const headLength = Math.min(CONNECTOR_ARROWHEAD_SIZE_WORLD * camera.zoom, length / 2);
  // The head's point is the end of the arrow; the line stops at the head's back edge.
  const lineEnd = shortenSegment(
    worldToScreen(camera, resolved.to),
    worldToScreen(camera, resolved.from),
    headLength,
  );
  // The dots are the four sides of the object under the pointer — or, once the pointer
  // has left every object, of the one the drag started on — each at the anchor an end
  // would really take while pointing where the other end is.
  const start = objectUnder(attachable, drag.from);
  const finish = objectUnder(attachable, drag.to);
  const hover = finish ?? start;
  // The dot that lights up is the side the dragging end would really be tied to, worked
  // out against where the other end resolved to — the same rule the arrow is drawn by.
  const other = finish === null ? resolved.from : resolved.to;
  const dots = dotsFor(hover ? rects.get(hover.id) ?? null : null, camera, other);
  return {
    line: [worldToScreen(camera, resolved.from), lineEnd],
    head: arrowheadPoints(worldToScreen(camera, resolved.to), direction, headLength),
    dots,
  };
}

/**
 * The four places an end can be tied to on one object, in screen pixels: the midpoint of
 * each side. With a point to aim at, the side that point falls to is the one lit up; with
 * none, the dots are only shown as possibilities.
 */
function dotsFor(rect: Rect | null, camera: Camera, aim: Point | null): Dot[] {
  if (rect === null) return [];
  const chosen = aim === null ? null : nearestSide(rect, aim);
  return SIDES.map((side) => ({
    side,
    screen: worldToScreen(camera, sideAnchor(rect, side)),
    active: side === chosen,
  }));
}

/** One connection point as the sheet draws it: chosen or not, in either case a dot. */
function dotCircle(dot: Dot): ReactElement {
  return (
    <circle
      key={dot.side}
      data-testid={`connector-dot-${dot.side}`}
      data-side={dot.side}
      data-active={dot.active ? 'true' : 'false'}
      cx={dot.screen.x}
      cy={dot.screen.y}
      r={dot.active ? CONNECTOR_DOT_RADIUS_PX + 1.5 : CONNECTOR_DOT_RADIUS_PX}
      fill={dot.active ? CONNECTOR_COLOR : '#ffffff'}
      stroke={CONNECTOR_COLOR}
      strokeWidth={1.5}
    />
  );
}

const sheetStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  // The tool sits between you and the board: it cannot be panned, marquee-d or clicked
  // through. The wheel is left to reach the board, so zooming still zooms the board.
  cursor: 'crosshair',
  touchAction: 'none',
  userSelect: 'none',
};

const svgStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  overflow: 'visible',
  // The sheet underneath is what takes the pointer; this is only what you see.
  pointerEvents: 'none',
};
