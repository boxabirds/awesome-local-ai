/**
 * Story 10 · task 13 — the connector object (design "ConnectorObject", PRD
 * `connector.follow`, `connector.reattach`, `shape.arrow_select`).
 *
 * An arrow is drawn from its two **resolved** end points, which `snapshot()`
 * recomputes from the live rectangles of whatever they point at. The component
 * therefore has no attachment logic of its own: every snapshot (a local drag, a
 * teammate's move, a delete that detached an end) hands it a new `ends`, and it
 * simply draws that line — which is what makes arrows follow objects across the
 * network with no writes.
 *
 * Three hit targets, all in screen-constant sizes:
 *  - an invisible thick `connector-hit` stroke (`2 × CONNECTOR_HIT_TOLERANCE_PX`
 *    of screen space, divided by zoom so the tolerance stays in pixels): pressing
 *    within 6 px of the line selects the arrow, further away does not;
 *  - the visible line and arrowhead, never hit-tested themselves;
 *  - while selected, two end handles. Dragging one re-attaches: the release
 *    hit-tests the live snapshot (excluding this arrow and the object at the
 *    other end, so a release on the object already connected snaps back) and
 *    writes `setConnectorEndpoint` in one undo step.
 *
 * Screen → world for those two gestures uses the SVG's own bounding box: a point
 * inside the world layer maps to `origin + (client − box.left) / zoom`, which is
 * exact in a browser and stays deterministic under jsdom's empty rects.
 */
import { useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  SHAPE_STROKE_COLORS,
} from '../../shared/config';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import type { Endpoint } from '../../shared/objects/connector';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { Point } from '../../shared/geometry';
import { hitTestAt } from './registry';
import type { UndoController } from '../board/undo';

export interface ConnectorObjectProps {
  /** The connector snapshot; `ends` are the already-resolved points. */
  conn: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editable?: boolean;
  /** The live board, for "what is under the pointer" during a handle drag. */
  getSnapshot(): readonly ObjectSnapshot[];
  onSelect(id: string, additive: boolean): void;
  undo?: UndoController;
}

/** Screen-pixel radius of an end handle (constant at any zoom). */
const HANDLE_RADIUS_PX = 5;

/** Drawing padding around the line, in world units, so the head is never clipped. */
const PAD = 24;

const LINE_COLOR = SHAPE_STROKE_COLORS.dark;

/** The line with its arrowhead, given the two endpoints in local coordinates. */
export function arrowheadPoints(from: Point, to: Point, size: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return `${to.x},${to.y} ${to.x},${to.y} ${to.x},${to.y}`;
  const ux = dx / length;
  const uy = dy / length;
  const baseX = to.x - ux * size;
  const baseY = to.y - uy * size;
  const half = size * 0.45;
  return [
    `${to.x},${to.y}`,
    `${baseX - uy * half},${baseY + ux * half}`,
    `${baseX + uy * half},${baseY - ux * half}`,
  ].join(' ');
}

interface HandleDrag {
  end: 'from' | 'to';
  x: number;
  y: number;
  /** The object currently under the pointer (null = empty space). */
  targetId: string | null;
}

export function ConnectorObject(props: ConnectorObjectProps): JSX.Element | null {
  const { conn, doc, zoom, selected, getSnapshot } = props;
  const ends = conn.ends;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<HandleDrag | null>(null);
  const editable = props.editable ?? true;

  // A connector with no resolvable geometry (a malformed record) draws nothing
  // rather than a dot at the origin.
  if (!ends) return null;

  const id = conn.id;
  const inverse = zoom > 0 ? 1 / zoom : 1;

  // The drawing box: both ends plus padding, in world coordinates. Local
  // coordinates inside the SVG are world minus this origin.
  const origin = {
    x: Math.min(ends.from.x, ends.to.x) - PAD,
    y: Math.min(ends.from.y, ends.to.y) - PAD,
  };
  const size = {
    x: Math.abs(ends.to.x - ends.from.x) + PAD * 2,
    y: Math.abs(ends.to.y - ends.from.y) + PAD * 2,
  };
  const local = (p: Point): Point => ({ x: p.x - origin.x, y: p.y - origin.y });
  const from = local(ends.from);
  const to = local(ends.to);

  const lineStroke = CONNECTOR_STROKE_WIDTH_WORLD;
  const hitStroke = (CONNECTOR_HIT_TOLERANCE_PX * 2) * inverse;
  const handleRadius = HANDLE_RADIUS_PX * inverse;

  /** Where a client point sits in world space (see the header note). */
  const worldOf = (clientX: number, clientY: number): Point => {
    const box = svgRef.current?.getBoundingClientRect();
    const left = box?.left ?? 0;
    const top = box?.top ?? 0;
    return { x: origin.x + (clientX - left) / zoom, y: origin.y + (clientY - top) / zoom };
  };

  const selectOnPress = (event: ReactPointerEvent<SVGElement>) => {
    event.stopPropagation();
    if (!editable) return;
    props.onSelect(id, event.shiftKey);
  };

  const startHandleDrag = (end: 'from' | 'to') => (event: ReactPointerEvent<SVGCircleElement>) => {
    event.stopPropagation();
    if (!editable) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom: capture is skipped; handlers still fire in order.
    }
    props.onSelect(id, false);
    setDrag({ end, x: event.clientX, y: event.clientY, targetId: null });
  };

  const moveHandleDrag = (event: ReactPointerEvent<SVGCircleElement>) => {
    const current = drag;
    if (current === null) return;
    event.stopPropagation();
    const point = worldOf(event.clientX, event.clientY);
    const hit = hitTestAt(snapshotWithout(getSnapshot(), id), point, zoom);
    const targetId = hit && hit.id !== otherEndObject(current.end) ? hit.id : null;
    setDrag({ ...current, x: event.clientX, y: event.clientY, targetId });
  };

  const otherEndObject = (end: 'from' | 'to'): string | null => {
    const other = end === 'from' ? conn.to : conn.from;
    return other && other.kind === 'attached' ? other.objectId : null;
  };

  const endHandleDrag = (event: ReactPointerEvent<SVGCircleElement>, cancelled: boolean) => {
    const current = drag;
    setDrag(null);
    if (current === null || cancelled) return;
    event.stopPropagation();
    const point = worldOf(event.clientX, event.clientY);
    const hit = cancelled ? null : hitTestAt(snapshotWithout(getSnapshot(), id), point, zoom);
    const blocked = hit !== null && hit.id === otherEndObject(current.end);
    if (blocked) return; // a release on the object already connected snaps back

    const endpoint: Endpoint =
      hit !== null && !blocked
        ? { kind: 'attached', objectId: hit.id, fallback: point }
        : { kind: 'free', x: point.x, y: point.y };
    const apply = () => {
      if (!setConnectorEndpoint(doc, id, current.end, endpoint)) return;
    };
    if (props.undo) props.undo.step(apply);
    else apply();
  };

  return (
    <div
      role="img"
      aria-label={
        conn.to?.kind === 'attached' ? 'Connector to shape' : 'Connector to free point'
      }
      data-testid={`connector-${id}`}
      data-connector-id={id}
      data-selected={selected ? 'true' : 'false'}
      data-editable={editable ? 'true' : 'false'}
      data-from={
        conn.from?.kind === 'attached' ? `attached:${conn.from.objectId}` : 'free'
      }
      data-to={conn.to?.kind === 'attached' ? `attached:${conn.to.objectId}` : 'free'}
      className="connector-object"
      style={{
        position: 'absolute',
        left: `${origin.x}px`,
        top: `${origin.y}px`,
        width: `${size.x}px`,
        height: `${size.y}px`,
        // The wrapper never captures: only the two strokes below do, so an empty
        // part of the box is still a clear miss (PRD `shape.arrow_select`).
        pointerEvents: 'none',
      }}
    >
      <svg
        ref={svgRef}
        data-testid="connector-svg"
        width={size.x}
        height={size.y}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
      >
        <line
          data-testid="connector-hit"
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="transparent"
          strokeWidth={hitStroke}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={selectOnPress}
        />
        <line
          data-testid="connector-line"
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={LINE_COLOR}
          strokeWidth={lineStroke}
          style={{ pointerEvents: 'none' }}
        />
        <polygon
          data-testid="connector-arrowhead"
          points={arrowheadPoints(from, to, CONNECTOR_ARROWHEAD_SIZE_WORLD)}
          fill={LINE_COLOR}
          style={{ pointerEvents: 'none' }}
        />
        {selected
          ? (['from', 'to'] as const).map((end) => {
              const p = end === 'from' ? from : to;
              return (
                <circle
                  key={end}
                  data-testid={`connector-handle-${end}`}
                  cx={p.x}
                  cy={p.y}
                  r={handleRadius}
                  fill="#ffffff"
                  stroke={LINE_COLOR}
                  strokeWidth={1.5 * inverse}
                  style={{ pointerEvents: 'all', cursor: 'grab' }}
                  onPointerDown={startHandleDrag(end)}
                  onPointerMove={moveHandleDrag}
                  onPointerUp={(event) => endHandleDrag(event, false)}
                  onPointerCancel={(event) => endHandleDrag(event, true)}
                  onLostPointerCapture={() => setDrag(null)}
                />
              );
            })
          : null}
      </svg>
    </div>
  );
}

/** The board without one id, so a handle never re-attaches to its own arrow. */
function snapshotWithout(
  snapshot: readonly ObjectSnapshot[],
  id: string,
): readonly ObjectSnapshot[] {
  return snapshot.filter((obj) => obj.id !== id);
}

/** Exposed for tests: is a point within the selection tolerance of this line? */
export function connectorHit(
  conn: ObjectSnapshot,
  worldPoint: Point,
  zoom: number,
): boolean {
  if (!conn.ends) return false;
  const tolerance = CONNECTOR_HIT_TOLERANCE_PX / (zoom > 0 ? zoom : 1);
  return distanceToPolyline([conn.ends.from, conn.ends.to], worldPoint) <= tolerance;
}
