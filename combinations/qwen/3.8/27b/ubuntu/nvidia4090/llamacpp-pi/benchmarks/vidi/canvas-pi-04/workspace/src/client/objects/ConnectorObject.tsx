// Story 10: one connector (arrow), end to end (anchor: connector.select,
// connector.reattach, connector.follow).
//
// The rendered line is DERIVED: `fromPoint`/`toPoint` come from the snapshot
// (resolveEndpoints in objectSnapshot), so the arrow follows its objects on
// every board update on every client — no component-local state is involved
// in following (connector.follow, key decision 1).
//
// Interaction:
//  - body: the invisible hit band (±CONNECTOR_HIT_TOLERANCE_PX screen px,
//    scaled by zoom into world units) selects the arrow (connector.select_body);
//  - ends: while selected, two handles appear at the resolved points. Dragging
//    a handle re-attaches it: a release over another object's attach point
//    (within the snap radius) attaches there; otherwise the end becomes free
//    at the pointer (connector.reattach). One boundary → one undo step.
//  - the world-layer children are pointer-events: none, so only the explicit
//    hit band / handles catch the pointer.

import { useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_HANDLE_RADIUS_PX,
  CONNECTOR_SNAP_RADIUS_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
  SHAPE_STROKE_COLORS,
} from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { ConnectorSnap, Endpoint } from '../../shared/objects/connector';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import type { Point } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { screenToWorld, type Camera } from '../canvas/camera';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';

/** The arrow's single colour (story 10 ships one; per-arrow colour is later). */
const ARROW_COLOR = SHAPE_STROKE_COLORS.dark;

interface AnchorHit {
  objectId: string;
  anchor: Point;
  /** Screen px distance from the pointer to the anchor. */
  distPx: number;
}

/**
 * The four side anchors of the objects of `snapshot`, and the nearest one to
 * a world point. Connectors attach to rectangular objects (sticky/text/
 * shape); connectors themselves are skipped (an arrow never attaches to an
 * arrow), and `exclude` removes the drag's own endpoints.
 */
function nearestAnchor(
  snapshot: readonly ObjectSnapshot[],
  point: Point,
  zoom: number,
  exclude: ReadonlySet<string>,
): AnchorHit | null {
  let best: AnchorHit | null = null;
  for (const o of snapshot) {
    if (o.type === 'connector' || exclude.has(o.id)) continue;
    const b = objectBounds(o);
    const anchors: Point[] = [
      { x: b.x + b.width / 2, y: b.y }, // top
      { x: b.x + b.width, y: b.y + b.height / 2 }, // right
      { x: b.x + b.width / 2, y: b.y + b.height }, // bottom
      { x: b.x, y: b.y + b.height / 2 }, // left
    ];
    for (const a of anchors) {
      const distPx = Math.hypot(a.x - point.x, a.y - point.y) * zoom;
      if (best === null || distPx < best.distPx) {
        best = { objectId: o.id, anchor: a, distPx };
      }
    }
  }
  return best;
}

export function ConnectorObject(props: ObjectProps): JSX.Element {
  const { obj, selected } = props;
  const conn = obj as ConnectorSnap;
  const snapshot = props.snapshot ?? [];
  const zoom = props.zoom ?? 1;
  // The camera changes with every render; the drag closures read it through
  // this ref so a pan during the drag still converts correctly.
  const camRef = { current: props.camera ?? ({ x: 0, y: 0, zoom: 1 } as Camera) };
  const undo = useUndoController();

  // The re-attach drag: which end is being moved and the live target.
  const [drag, setDrag] = useState<{
    which: 'from' | 'to';
    point: Point;
    hit: AnchorHit | null;
  } | null>(null);

  // --- the re-attach drag (window-level, like the transform gesture) --------
  const beginHandleDrag = (which: 'from' | 'to') => (e: ReactPointerEvent<SVGCircleElement>): void => {
    if (!props.canEdit) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); // never starts a select/move gesture
    const id = e.pointerId;
    undo?.boundary(); // one re-attach (or re-free) is one undo step

    const toWorld = (clientX: number, clientY: number): Point | null => {
      const root = document.querySelector('[data-testid="board-viewport"]');
      if (root === null) return null;
      const rect = root.getBoundingClientRect();
      // jsdom reports a zero-sized rect: skip the bounds check there.
      const inside =
        rect.width === 0 && rect.height === 0
          ? true
          : clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      if (!inside) return null;
      return screenToWorld(camRef.current, { x: clientX - rect.left, y: clientY - rect.top });
    };

    const resolveHit = (p: Point): AnchorHit | null => {
      const other = which === 'from' ? conn.to : conn.from;
      const exclude = new Set<string>([obj.id]);
      if (other.kind === 'attached') exclude.add(other.objectId);
      const hit = nearestAnchor(snapshot, p, zoom, exclude);
      return hit !== null && hit.distPx <= CONNECTOR_SNAP_RADIUS_PX ? hit : null;
    };

    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      const p = toWorld(e.clientX, e.clientY);
      if (p === null) return;
      setDrag({ which, point: p, hit: resolveHit(p) });
    };
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const p = toWorld(e.clientX, e.clientY);
      if (p !== null) {
        const hit = resolveHit(p);
        if (hit !== null) {
          const endpoint: Endpoint = {
            kind: 'attached',
            objectId: hit.objectId,
            fallback: hit.anchor,
          };
          setConnectorEndpoint(props.doc, obj.id, which, endpoint);
        } else {
          setConnectorEndpoint(props.doc, obj.id, which, { kind: 'free', x: p.x, y: p.y });
        }
      }
      setDrag(null);
      undo?.boundary();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    // Seed the preview at the handle position.
    const p0 = toWorld(e.clientX, e.clientY);
    if (p0 !== null) setDrag({ which, point: p0, hit: resolveHit(p0) });
  };

  // --- geometry ----------------------------------------------------------------
  // Bounding box of the (possibly preview) line plus padding for the
  // arrowhead; the SVG is positioned in world coordinates (the world layer
  // applies the camera transform).
  const pts: Point[] = [conn.fromPoint, conn.toPoint];
  if (drag !== null) pts.push(drag.point);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = CONNECTOR_ARROWHEAD_SIZE_WORLD + 4;
  const svgX = minX - pad;
  const svgY = minY - pad;
  const svgW = Math.max(1, maxX - minX + pad * 2);
  const svgH = Math.max(1, maxY - minY + pad * 2);
  const hitWidth = Math.max(CONNECTOR_STROKE_WIDTH_WORLD, (2 * CONNECTOR_HIT_TOLERANCE_PX) / zoom);

  const dragEndpoint = drag !== null ? (drag.which === 'from' ? conn.toPoint : conn.fromPoint) : null;

  return (
    <svg
      className="connector-object"
      data-testid="connector-object"
      data-connector-id={obj.id}
      data-selected={selected ? '' : undefined}
      width={svgW}
      height={svgH}
      viewBox={`${svgX} ${svgY} ${svgW} ${svgH}`}
      aria-label="Arrow"
      style={{ left: svgX, top: svgY, overflow: 'visible' }}
    >
      <defs>
        <marker
          id={`arrow-${obj.id}`}
          markerWidth={CONNECTOR_ARROWHEAD_SIZE_WORLD}
          markerHeight={CONNECTOR_ARROWHEAD_SIZE_WORLD}
          refX={CONNECTOR_ARROWHEAD_SIZE_WORLD}
          refY={CONNECTOR_ARROWHEAD_SIZE_WORLD / 2}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d={`M0 0 L${CONNECTOR_ARROWHEAD_SIZE_WORLD} ${CONNECTOR_ARROWHEAD_SIZE_WORLD / 2} L0 ${CONNECTOR_ARROWHEAD_SIZE_WORLD} Z`}
            fill={ARROW_COLOR}
          />
        </marker>
      </defs>
      {/* Body: the visible arrow. */}
      <line
        className="connector-object__body"
        data-testid="connector-body"
        x1={conn.fromPoint.x}
        y1={conn.fromPoint.y}
        x2={conn.toPoint.x}
        y2={conn.toPoint.y}
        stroke={ARROW_COLOR}
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        markerEnd={`url(#arrow-${obj.id})`}
      />
      {/* Hit band: an invisible wide stroke so the arrow is clickable at any
          zoom (connector.select_body). */}
      <line
        className="connector-object__hit"
        data-testid="connector-hit"
        x1={conn.fromPoint.x}
        y1={conn.fromPoint.y}
        x2={conn.toPoint.x}
        y2={conn.toPoint.y}
        stroke="transparent"
        strokeWidth={hitWidth}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          // The DOM band (pointer-events: stroke) is the primary mechanism;
          // this explicit check enforces the same ±CONNECTOR_HIT_TOLERANCE_PX
          // screen-px contract where CSS hit-testing is unavailable (jsdom).
          const root = document.querySelector('[data-testid="board-viewport"]');
          if (root !== null) {
            const rect = root.getBoundingClientRect();
            const p = screenToWorld(camRef.current, {
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
            });
            if (
              distanceToPolyline([conn.fromPoint, conn.toPoint], p) >
              CONNECTOR_HIT_TOLERANCE_PX / zoom
            ) {
              return;
            }
          }
          e.stopPropagation();
          props.onPointerDown(e);
        }}
      />
      {/* Re-attach preview: a dashed line from the fixed end to the pointer. */}
      {drag !== null && dragEndpoint !== null && (
        <line
          className="connector-object__preview"
          x1={dragEndpoint.x}
          y1={dragEndpoint.y}
          x2={drag.point.x}
          y2={drag.point.y}
          stroke={ARROW_COLOR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeDasharray="6 4"
        />
      )}
      {/* End handles: visible while selected; drag to re-attach. */}
      {selected && (
        <>
          {(drag === null || drag.which === 'from') && (
            <circle
              className="connector-object__handle"
              data-testid="connector-handle-from"
              cx={conn.fromPoint.x}
              cy={conn.fromPoint.y}
              r={CONNECTOR_HANDLE_RADIUS_PX / zoom}
              fill="#FFFFFF"
              stroke={ARROW_COLOR}
              strokeWidth={2 / zoom}
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={beginHandleDrag('from')}
            />
          )}
          {(drag === null || drag.which === 'to') && (
            <circle
              className="connector-object__handle"
              data-testid="connector-handle-to"
              cx={conn.toPoint.x}
              cy={conn.toPoint.y}
              r={CONNECTOR_HANDLE_RADIUS_PX / zoom}
              fill="#FFFFFF"
              stroke={ARROW_COLOR}
              strokeWidth={2 / zoom}
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={beginHandleDrag('to')}
            />
          )}
          {/* Snap highlight: the anchor the release would attach to. */}
          {drag !== null && drag.hit !== null && (
            <circle
              className="connector-object__snap"
              cx={drag.hit.anchor.x}
              cy={drag.hit.anchor.y}
              r={(CONNECTOR_SNAP_RADIUS_PX * 0.6) / zoom}
              fill="none"
              stroke={ARROW_COLOR}
              strokeWidth={2 / zoom}
              style={{ pointerEvents: 'none' }}
            />
          )}
        </>
      )}
    </svg>
  );
}
