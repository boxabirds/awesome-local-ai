/**
 * One connector (story 10, connector.ui): a straight arrow from endpoint A
 * to B with an arrowhead at the target end.
 *
 * - Selecting: a pointerdown within CONNECTOR_HIT_TOLERANCE_PX (screen) of
 *   the line selects it (the line carries an invisible, wider hit stroke);
 *   clicking empty space never selects a connector (the Board's registry
 *   hit test keeps that true).
 * - Re-attaching: when selected, both ends show re-attach handles (dots).
 *   Dragging a handle and releasing it over another object re-attaches that
 *   endpoint (the model attaches it to the nearest side anchor of the
 *   release point); releasing over empty space makes it free. Moving an
 *   attached object moves the arrow with it — the endpoints re-resolve on
 *   every render, no client work.
 * - The object is inert (no events) unless the Select tool is active; the
 *   tool layer of the creation tools owns the board while they run.
 */
import { type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_INK_COLOR,
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
} from '../../shared/config';
import {
  arrowheadPoints,
  nearestSide,
  sideAnchor,
} from '../../shared/geometry/connector-geometry';
import { snapshotRects, type ObjectSnapshot, type Rect } from '../../shared/board-model';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import type { ObjectProps } from './registry';

/** Screen-constant re-attach handle colour. */
const HANDLE_COLOR = '#1a73e8';

export function ConnectorObject(props: ObjectProps): JSX.Element {
  const { doc, obj, selected, inert, camera, objects, onPointerDown, onBoundary } = props;
  const from = obj.fromPoint;
  const to = obj.toPoint;
  const width = obj.width ?? 0;
  const height = obj.height ?? 0;
  const zoom = camera?.zoom ?? 1;
  const safeZoom = zoom > 0 ? zoom : 1;

  // Line + arrowhead geometry, in the svg's local (bbox-relative) space.
  const dx = (to?.x ?? 0) - (from?.x ?? 0);
  const dy = (to?.y ?? 0) - (from?.y ?? 0);
  const length = Math.hypot(dx, dy);
  const hasLine = from !== undefined && to !== undefined;
  const arrow =
    hasLine && length > 0.001
      ? arrowheadPoints(from!, to!, CONNECTOR_ARROWHEAD_SIZE_WORLD)
      : undefined;

  /**
   * Starts a re-attach drag for `end`: on release over another object the
   * endpoint re-attaches (nearest side anchor of the release point); over
   * empty space it becomes a free point.
   */
  const startReattach = (e: ReactPointerEvent<SVGCircleElement>, end: 'from' | 'to'): void => {
    e.stopPropagation();
    if (!camera) {
      return;
    }
    // Captured now: React's synthetic currentTarget is not stable by the
    // time the window pointerup fires.
    const circle = e.currentTarget;
    const finish = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      const vp = circle.closest('[data-testid="board-viewport"]');
      const rect = vp ? vp.getBoundingClientRect() : undefined;
      if (rect === undefined) {
        return;
      }
      const world = screenToWorld(camera, { x: ev.clientX - rect.left, y: ev.clientY - rect.top });
      const all = objects ?? [];
      // Topmost object (by z) whose rect contains the release point; never
      // this connector, never the object the OTHER endpoint is attached to
      // (a connector never points at itself).
      const rects = snapshotRects(all);
      let best: { id: string; z: number; rect: Rect } | undefined;
      const opposite = end === 'from' ? obj.to : obj.from;
      const oppositeId =
        opposite !== undefined && opposite.kind === 'attached' ? opposite.objectId : null;
      for (const o of all) {
        if (o.type === 'connector') {
          continue;
        }
        if (oppositeId !== null && o.id === oppositeId) {
          continue; // never re-attach an end onto the opposite end's object
        }
        const r = rects.get(o.id);
        if (r === undefined) {
          continue;
        }
        if (world.x < r.x || world.x >= r.x + r.width || world.y < r.y || world.y >= r.y + r.height) {
          continue;
        }
        if (best === undefined || o.z >= best.z) {
          best = { id: o.id, z: o.z, rect: r };
        }
      }
      if (best !== undefined) {
        // The facing side is the side nearest the OTHER endpoint (fall back
        // to the release point when the other end has no resolved point).
        const otherPoint: Point =
          (end === 'from' ? obj.toPoint : obj.fromPoint) ?? {
            x: best.rect.x + best.rect.width / 2,
            y: best.rect.y + best.rect.height / 2,
          };
        onBoundary?.();
        setConnectorEndpoint(doc, obj.id, end, {
          kind: 'attached',
          objectId: best!.id,
          fallback: sideAnchor(best!.rect, nearestSide(best!.rect, otherPoint)),
        });
      } else {
        onBoundary?.();
        setConnectorEndpoint(doc, obj.id, end, { kind: 'free', x: world.x, y: world.y });
      }
    };
    const onMove = (): void => {
      // The commit happens on release; the line itself updates live once
      // the endpoint changes.
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const rel = (p: Point): Point => ({ x: p.x - (obj.x ?? 0), y: p.y - (obj.y ?? 0) });

  return (
    <div
      data-connector-object={obj.id}
      data-object-id={obj.id}
      data-testid="connector-object"
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: `${obj.x ?? 0}px`,
        top: `${obj.y ?? 0}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: obj.z,
        overflow: 'visible',
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }}
    >
      <svg
        width={Math.max(1, width)}
        height={Math.max(1, height)}
        viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
        aria-hidden="true"
      >
        {hasLine && (
          <>
            {/* Visible line + arrowhead. */}
            <line
              x1={rel(from!).x}
              y1={rel(from!).y}
              x2={rel(to!).x}
              y2={rel(to!).y}
              stroke={CONNECTOR_INK_COLOR}
              strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
              strokeLinecap="round"
              pointerEvents="none"
            />
            {arrow && (
              <polygon
                points={`${rel(arrow.baseLeft).x},${rel(arrow.baseLeft).y} ${rel(arrow.tip).x},${rel(arrow.tip).y} ${rel(arrow.baseRight).x},${rel(arrow.baseRight).y}`}
                fill={CONNECTOR_INK_COLOR}
                stroke={CONNECTOR_INK_COLOR}
                strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD / 2}
                strokeLinejoin="round"
                pointerEvents="none"
              />
            )}
            {/* Invisible hit stroke: ~2x the screen tolerance, always clickable. */}
            <line
              data-testid="connector-hit-line"
              x1={rel(from!).x}
              y1={rel(from!).y}
              x2={rel(to!).x}
              y2={rel(to!).y}
              stroke="transparent"
              strokeWidth={(2 * CONNECTOR_HIT_TOLERANCE_PX) / safeZoom}
              strokeLinecap="round"
              pointerEvents={inert ? 'none' : 'stroke'}
              style={{ cursor: selected ? 'grab' : 'pointer' }}
              onPointerDown={(e) => {
                if (inert) {
                  return;
                }
                e.stopPropagation();
                onPointerDown(e, obj.id);
              }}
            />
          </>
        )}
        {/* Re-attach handles, visible while selected (screen-constant size). */}
        {selected && !inert && hasLine && (
          <>
            <circle
              data-testid="connector-handle-from"
              cx={rel(from!).x}
              cy={rel(from!).y}
              r={CONNECTOR_DOT_RADIUS_PX / safeZoom}
              fill="#fff"
              stroke={HANDLE_COLOR}
              strokeWidth={2 / safeZoom}
              pointerEvents="auto"
              style={{ cursor: 'crosshair' }}
              onPointerDown={(e) => startReattach(e, 'from')}
            />
            <circle
              data-testid="connector-handle-to"
              cx={rel(to!).x}
              cy={rel(to!).y}
              r={CONNECTOR_DOT_RADIUS_PX / safeZoom}
              fill="#fff"
              stroke={HANDLE_COLOR}
              strokeWidth={2 / safeZoom}
              pointerEvents="auto"
              style={{ cursor: 'crosshair' }}
              onPointerDown={(e) => startReattach(e, 'to')}
            />
          </>
        )}
      </svg>
    </div>
  );
}
