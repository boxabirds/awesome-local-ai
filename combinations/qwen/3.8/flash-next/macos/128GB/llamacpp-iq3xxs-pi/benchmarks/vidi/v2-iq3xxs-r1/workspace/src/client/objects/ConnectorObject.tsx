import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Rect } from '../../shared/geometry';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import {
  setConnectorEndpoint,
  type ConnectorSnap,
  type EndpointInput,
} from '../../shared/objects/connector';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import type { UndoController } from '../board/undo';

export interface ConnectorObjectProps {
  connector: ConnectorSnap;
  /**
   * Rectangles of every object an arrow may be attached to, so releasing a handle
   * over one of them attaches that end (design: `rects`).
   */
  rects: Map<string, Rect>;
  doc: Y.Doc;
  selected: boolean;
  /** Camera zoom: the hit line and the handles keep their size on screen. */
  zoom: number;
  /** The camera, so a dragged handle follows the pointer at any zoom or pan. */
  camera?: Camera;
  /** False while the board cannot be edited (it failed to load): handles are hidden. */
  editable?: boolean;
  /** Press on the line itself: select it and let the generic gesture move it. */
  onObjectPointerDown?(e: PointerEvent, id: string): void;
  onSelect?(id: string): void;
  /** This tab's undo history: one handle drag is one step of its own. */
  undo?: UndoController;
}

/** The end whose handle is being dragged. */
export type ConnectorEnd = 'from' | 'to';

/**
 * The three points of an arrowhead at `to`, pointing away from `from`
 * (PRD conn.arrowhead). No SVG marker is used: a marker's size is defined in the
 * stroke's units and would grow with the world stroke width instead of staying a
 * constant one, so the triangle is computed here.
 */
export function arrowheadPoints(
  from: Point,
  to: Point,
  size = CONNECTOR_ARROWHEAD_SIZE_WORLD,
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  // A zero-length arrow has no direction to point at; it draws nothing.
  if (len === 0) return '';
  const ux = dx / len;
  const uy = dy / len;
  const tip = to;
  const backX = to.x - ux * size;
  const backY = to.y - uy * size;
  const half = size / 2;
  return [
    `${tip.x},${tip.y}`,
    `${backX - uy * half},${backY + ux * half}`,
    `${backX + uy * half},${backY - ux * half}`,
  ].join(' ');
}

/**
 * One connector: the line, the arrowhead, the hit line and the two end handles.
 *
 * Everything is drawn in world units inside the world layer, so panning and zooming
 * move the arrow for free; only the things that must stay legible on screen — the
 * tolerance line and the handles — are divided by the zoom. Where the ends are is
 * already resolved in the snapshot, so this component holds no geometry of its own:
 * when an object moves, the arrow is drawn from the same read that moved it (PRD
 * conn.follow) and nothing is written to the document.
 */
export function ConnectorObject({
  connector,
  rects,
  doc,
  selected,
  zoom,
  camera,
  editable = true,
  onObjectPointerDown,
  onSelect,
  undo,
}: ConnectorObjectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [dragEnd, setDragEnd] = useState<{ end: ConnectorEnd; at: Point } | null>(null);
  const live = useRef({ connector, rects, doc, editable, camera, onObjectPointerDown, onSelect, undo });
  live.current = { connector, rects, doc, editable, camera, onObjectPointerDown, onSelect, undo };
  const draggingEnd = useRef<ConnectorEnd | null>(null);

  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const el = rootRef.current;
    if (!el || !live.current.camera) return { x: 0, y: 0 };
    // Screen to world is measured from the board viewport, whose box the camera is
    // defined against; the connector's own box is a single point.
    const surface = el.closest('.board-viewport') ?? el;
    const rect = surface.getBoundingClientRect();
    return screenToWorld(live.current.camera, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  /** The object under a world point that this end may attach to, if any. */
  const attachAt = (world: Point): string | null => {
    let chosen: string | null = null;
    for (const [id, rect] of live.current.rects) {
      // An arrow is not attached to another arrow.
      if (id === live.current.connector.id) continue;
      if (world.x < rect.x || world.y < rect.y) continue;
      if (world.x > rect.x + rect.width || world.y > rect.y + rect.height) continue;
      chosen = id;
    }
    return chosen;
  };

  // A handle drag is tracked on the window, so the pointer may leave the arrow
  // behind, and is discarded wholesale if the gesture is cancelled (TC-21).
  useEffect(() => {
    const onPointerMove = (e: PointerEvent): void => {
      if (!draggingEnd.current) return;
      setDragEnd({ end: draggingEnd.current, at: toWorld(e) });
    };
    const onPointerUp = (e: PointerEvent): void => {
      const end = draggingEnd.current;
      if (!end) return;
      draggingEnd.current = null;
      const world = toWorld(e);
      setDragEnd(null);
      const object = attachAt(world);
      const next: EndpointInput = object
        ? { kind: 'attached', objectId: object }
        : { kind: 'free', x: world.x, y: world.y };
      live.current.undo?.boundary();
      setConnectorEndpoint(live.current.doc, live.current.connector.id, end, next);
      live.current.undo?.boundary();
    };
    const onPointerCancel = (): void => {
      // "Escape during the drag changes nothing": no write of any kind.
      if (!draggingEnd.current) return;
      draggingEnd.current = null;
      setDragEnd(null);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, []);

  const from = dragEnd && dragEnd.end === 'from' ? dragEnd.at : connector.ends.from;
  const to = dragEnd && dragEnd.end === 'to' ? dragEnd.at : connector.ends.to;
  // The stroke is a world width so it scales with the board, as PRD conn.arrowhead asks.
  const stroke = CONNECTOR_STROKE_WIDTH_WORLD;
  const tolerance = (CONNECTOR_HIT_TOLERANCE_PX * 2) / (zoom > 0 ? zoom : 1);
  const dotR = CONNECTOR_DOT_RADIUS_PX / (zoom > 0 ? zoom : 1);
  const color = selected ? '#1a73e8' : '#3c4043';

  const startHandle = (end: ConnectorEnd) => (e: React.PointerEvent): void => {
    if (!live.current.editable || e.button !== 0) return;
    e.stopPropagation();
    draggingEnd.current = end;
    setDragEnd({ end, at: end === 'from' ? from : to });
  };

  return (
    <div
      ref={rootRef}
      className="connector-object"
      data-object-root=""
      data-connector-root=""
      data-connector-id={connector.id}
      data-testid="connector-object"
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Connector"
      style={{ left: 0, top: 0, width: 0, height: 0 }}
    >
      <svg
        className="connector-svg"
        data-testid="connector-svg"
        width={0}
        height={0}
        aria-hidden={selected ? undefined : 'true'}
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        {selected ? (
          <line
            className="connector-selection-halo"
            data-testid="connector-halo"
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="#1a73e8"
            strokeOpacity={0.35}
            strokeWidth={stroke * 4}
            strokeLinecap="round"
          />
        ) : null}
        {/* The hit line is invisible and wide: 6 px either side of the line on screen,
            which is what makes a thin arrow clickable (TC-20). */}
        <line
          className="connector-hit"
          data-testid="connector-hit"
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="transparent"
          strokeWidth={tolerance}
          style={{ pointerEvents: 'stroke' }}
          onPointerDown={(e) => {
            if (!editable || e.button !== 0) return;
            e.stopPropagation();
            if (onObjectPointerDown) onObjectPointerDown(e.nativeEvent, connector.id);
            else onSelect?.(connector.id);
          }}
        />
        <line
          className="connector-line"
          data-testid="connector-line"
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <polygon
          className="connector-arrowhead"
          data-testid="connector-arrowhead"
          points={arrowheadPoints(from, to)}
          fill={color}
        />
        {selected && editable ? (
          <>
            <circle
              className="connector-handle"
              data-testid="connector-handle-from"
              data-end="from"
              role="button"
              aria-label="Start of connector"
              tabIndex={0}
              cx={from.x}
              cy={from.y}
              r={dotR * 2}
              fill="#ffffff"
              stroke="#1a73e8"
              strokeWidth={dotR / 2}
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={startHandle('from')}
            />
            <circle
              className="connector-handle"
              data-testid="connector-handle-to"
              data-end="to"
              role="button"
              aria-label="End of connector"
              tabIndex={0}
              cx={to.x}
              cy={to.y}
              r={dotR * 2}
              fill="#ffffff"
              stroke="#1a73e8"
              strokeWidth={dotR / 2}
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={startHandle('to')}
            />
          </>
        ) : null}
      </svg>
    </div>
  );
}

/** Screen-space position of one end, exported for tests that measure the handles. */
export function endOnScreen(camera: Camera, end: Point): Point {
  return worldToScreen(camera, end);
}
