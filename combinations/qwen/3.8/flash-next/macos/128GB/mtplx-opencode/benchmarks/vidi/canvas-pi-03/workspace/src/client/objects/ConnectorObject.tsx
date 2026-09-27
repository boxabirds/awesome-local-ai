import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ConnectorSnapshot } from '../../shared/board-model';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import { connectorBBox, resolveEndpoints, type Endpoint } from '../../shared/geometry/connector-geometry';
import { CONNECTOR_ARROWHEAD_SIZE_WORLD, CONNECTOR_DOT_RADIUS_PX, CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_STROKE_WIDTH_WORLD } from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';

/** The arrow's ink colour: the default outline colour of the palette. Arrows
 * take no style of their own in this story (contract `connector.ui`: no line
 * styles, no arrowhead choices). */
const ARROW_COLOUR = '#263238';

/** Empty space around the drawn line that still receives pointer events, in
 * world units. It has to grow with zoom or "click within 6 screen pixels of the
 * line" would shrink as the board is zoomed in. */
function hitPad(zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return CONNECTOR_HIT_TOLERANCE_PX / z + CONNECTOR_ARROWHEAD_SIZE_WORLD;
}

/** The rectangle of one handle's grab area, centred on `p`, in local units. */
function handleBox(p: Point, size: number): { x: number; y: number; size: number } {
  return { x: p.x - size / 2, y: p.y - size / 2, size };
}

/** The smallest box containing the line and both handles' grab areas. */
function frameOf(from: Point, to: Point, pad: number): Rect {
  const box = connectorBBox(from, to);
  return { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
}

/** The object under a point: the smallest box that contains it. Arrows are not
 * attach targets, and neither is the object at the other end of the arrow, so
 * the caller filters those out. */
function targetAt(rects: ReadonlyMap<string, Rect>, p: Point, exclude: readonly string[]): string | null {
  let best: string | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const [id, rect] of rects) {
    if (exclude.includes(id)) continue;
    if (p.x < rect.x || p.y < rect.y) continue;
    if (p.x > rect.x + rect.width || p.y > rect.y + rect.height) continue;
    const area = rect.width * rect.height;
    if (area < bestArea) {
      best = id;
      bestArea = area;
    }
  }
  return best;
}

export interface ConnectorObjectProps {
  connector: ConnectorSnapshot;
  /** Every box on the board, keyed by id — what the ends resolve against. */
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  selected: boolean;
  /** The board's zoom, so the click tolerance stays a SCREEN measurement. */
  zoom: number;
  /** Screen point (board-relative, as a browser reports it) → world point. */
  toWorld?(screen: Point): Point;
  /** A click on the line selects the arrow. */
  onSelect?(id: string): void;
  /** False while the board cannot be loaded: handles are not offered. */
  editable?: boolean;
}

/** What a handle drag is doing right now. */
interface HandleDrag {
  end: 'from' | 'to';
  /** The point the pointer is over, in world units. */
  point: Point;
  /** True once the pointer has moved far enough to be a re-route, not a click. */
  moved: boolean;
}

/**
 * A drawn arrow.
 *
 * The line is never stored: it is resolved from the live boxes on every render,
 * which is what lets it follow a shape that anyone moves and switch to the
 * nearer side as it passes an end. Pointer-wise the arrow is deliberately thin
 * — only a band `CONNECTOR_HIT_TOLERANCE_PX` wide around the line accepts a
 * click, so a click inside the arrow's bounding box but far from the line
 * selects what is underneath instead (contract `connector.select`).
 *
 * A selected arrow offers a handle at each end: released over another object it
 * re-attaches, over empty space it detaches and pins the end to that board
 * point (contract `connector.reattach`).
 */
export function ConnectorObject({
  connector,
  rects,
  doc,
  selected,
  zoom,
  toWorld,
  onSelect,
  editable = true,
}: ConnectorObjectProps) {
  const [drag, setDrag] = useState<HandleDrag | null>(null);
  const dragRef = useRef<HandleDrag | null>(null);
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  const ends = resolveEndpoints({ from: connector.from, to: connector.to }, rects);
  const pad = hitPad(z);
  const frame = frameOf(ends.from, ends.to, pad);

  // Local drawing coordinates: the frame's top-left corner is the SVG's origin,
  // so the line lands where the arrow is without a second transform.
  const from = { x: ends.from.x - frame.x, y: ends.from.y - frame.y };
  const to = { x: ends.to.x - frame.x, y: ends.to.y - frame.y };

  const world = (e: ReactPointerEvent<SVGElement | SVGRectElement>): Point => {
    if (toWorld) return toWorld({ x: e.clientX, y: e.clientY });
    const host = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - host.left) / z, y: (e.clientY - host.top) / z };
  };

  const startHandle = (e: ReactPointerEvent<SVGRectElement>, end: 'from' | 'to') => {
    if (e.button !== 0 || !editable) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const point = world(e);
    dragRef.current = { end, point, moved: false };
    setDrag({ end, point, moved: false });
  };

  const moveHandle = (e: ReactPointerEvent<SVGRectElement>) => {
    const current = dragRef.current;
    if (current === null) return;
    e.stopPropagation();
    const point = world(e);
    current.point = point;
    current.moved = true;
    dragRef.current = current;
    setDrag({ ...current });
  };

  const endHandle = (e: ReactPointerEvent<SVGRectElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (current === null) return;
    e.stopPropagation();
    const point = current.point;
    const other = (current.end === 'from' ? connector.to : connector.from) as Endpoint;
    const exclude = [connector.id, ...(other.kind === 'attached' ? [other.objectId] : [])];
    const hit = targetAt(rects, point, exclude);
    const next: Endpoint =
      hit === null ? { kind: 'free', x: point.x, y: point.y } : { kind: 'attached', objectId: hit, fallback: point };
    // A release on the object at the other end (or a re-route too short to draw)
    // is refused by the model and the arrow snaps back to where it was.
    setConnectorEndpoint(doc, connector.id, current.end, next);
  };

  const selectLine = (e: ReactPointerEvent<SVGLineElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect?.(connector.id);
  };

  const handleSize = (CONNECTOR_DOT_RADIUS_PX * 2 + 4) / z;
  const arrow = arrowPoints(from, to, z);

  return (
    <div
      role="img"
      aria-label="Arrow"
      data-testid="connector"
      data-connector-id={connector.id}
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        // The box itself is transparent to the pointer: only the band around the
        // line and the two handles accept events (contract `connector.select`).
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <svg
        width={frame.width}
        height={frame.height}
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
        aria-hidden="true"
      >
        {/* The invisible fat copy is the hit area: `stroke` means only the band
            around the line takes a click, not the box around it. */}
        <line
          data-testid="connector-hit"
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="transparent"
          strokeWidth={2 * (CONNECTOR_HIT_TOLERANCE_PX / z)}
          pointerEvents="stroke"
          onPointerDown={selectLine}
          style={{ cursor: 'default' }}
        />
        <line
          data-testid="connector-line"
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={ARROW_COLOUR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          pointerEvents="none"
        />
        <polygon points={arrow} fill={ARROW_COLOUR} pointerEvents="none" />
        {selected &&
          (['from', 'to'] as const).map((end) => {
            const p = end === 'from' ? from : to;
            const box = handleBox(p, handleSize);
            return (
              <rect
                key={end}
                data-testid={`connector-handle-${end}`}
                x={box.x}
                y={box.y}
                width={box.size}
                height={box.size}
                fill="#ffffff"
                stroke={ARROW_COLOUR}
                strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
                pointerEvents="all"
                style={{ cursor: 'crosshair' }}
                onPointerDown={(e) => startHandle(e, end)}
                onPointerMove={moveHandle}
                onPointerUp={endHandle}
                onPointerCancel={endHandle}
              />
            );
          })}
        {drag !== null && (
          <line
            data-testid="connector-reroute"
            x1={(drag.end === 'from' ? from : to).x}
            y1={(drag.end === 'from' ? from : to).y}
            x2={drag.point.x - frame.x}
            y2={drag.point.y - frame.y}
            stroke="#2563eb"
            strokeWidth={1.5 / z}
            strokeDasharray={`${4 / z} ${3 / z}`}
            pointerEvents="none"
          />
        )}
      </svg>
    </div>
  );
}

/** The arrowhead: a triangle whose tip is the arrow's end, scaled so it keeps
 * its screen size as the board zooms. */
function arrowPoints(from: Point, to: Point, zoom: number): string {
  const size = CONNECTOR_ARROWHEAD_SIZE_WORLD / Math.max(zoom, 0.0001);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return '';
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const half = size / 2;
  const tip = `${to.x},${to.y}`;
  const left = `${to.x - ux * size + px * half},${to.y - uy * size + py * half}`;
  const right = `${to.x - ux * size - px * half},${to.y - uy * size - py * half}`;
  return `${tip} ${left} ${right}`;
}
