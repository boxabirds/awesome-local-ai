import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import * as Y from 'yjs';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '@/shared/config';
import type { Endpoint } from '@/shared/objects/connector';
import { setConnectorEndpoint } from '@/shared/objects/connector';
import { nearestSide, sideAnchor } from '@/shared/geometry/connector-geometry';
import type { Point } from '@/shared/geometry';
import { objectBounds } from '@/shared/board-model';
import type { ObjectSnapshot } from '@/shared/board-model';
import { screenToWorld } from '../canvas/camera';
import { useCameraContext } from '../canvas/CameraContext';
import { getObjectType } from './registry';
import type { ObjectProps } from './registry';

/**
 * A connector object (story 10, conn.render/conn.select): the segment from
 * the resolved `from` to the resolved `to` (the snapshot carries both), an
 * arrowhead at `to`, rendered in world units so line and arrowhead scale
 * with zoom (conn.style).
 *
 * - Selection: an invisible fat line (2 x CONNECTOR_HIT_TOLERANCE_PX / zoom
 *   world units) is the browser's hit target — exactly the registry
 *   hitTest rule (distance to the centerline <= tolerance).
 * - Endpoint handles (selected only): small circles at each end. Dragging a
 *   handle re-targets that end on release (setConnectorEndpoint): attached
 *   to the object under the pointer (nearest side anchor) or free at the
 *   release point. Rejections (same object at both ends) simply snap back —
 *   the endpoint is left untouched (connector.no_accidental).
 */

export interface ConnectorObjectProps extends ObjectProps {
  doc?: Y.Doc;
  zoom?: number;
  editable?: boolean;
  /** All live objects (for the handle-release hit test). */
  objects?: readonly ObjectSnapshot[];
  /** Story 8: close the capture window around the endpoint commit. */
  onBoundary?: () => void;
}

const LINE_COLOR = '#374151';
const SELECT_COLOR = '#1A73E8';

export function ConnectorObject(props: ConnectorObjectProps): ReactElement | null {
  const { camera } = useCameraContext();
  const from = props.from as Endpoint | undefined;
  const to = props.to as Endpoint | undefined;
  const fromPoint = props.fromPoint as Point | undefined;
  const toPoint = props.toPoint as Point | undefined;
  if (from === undefined || to === undefined || fromPoint === undefined || toPoint === undefined) {
    return null; // malformed endpoints: render nothing (forward compatibility)
  }

  const selected = props.selected === true;
  const readOnly = props.editable === false;
  const zoom = typeof props.zoom === 'number' && props.zoom > 0 ? props.zoom : 1;
  const doc = props.doc as Y.Doc | undefined;

  // Handle drag: local visual move only; the doc is committed once, on
  // release (setConnectorEndpoint).
  const [dragEnd, setDragEnd] = useState<'from' | 'to' | null>(null);
  const [dragPoint, setDragPoint] = useState<Point | null>(null);

  useEffect(() => {
    if (dragEnd === null) return;
    const toWorld = (e: PointerEvent): Point =>
      screenToWorld(camera, { x: e.clientX, y: e.clientY });

    const onMove = (e: PointerEvent): void => {
      setDragPoint(toWorld(e));
    };
    const onUp = (e: PointerEvent): void => {
      const end = dragEnd;
      const p = toWorld(e);
      setDragEnd(null);
      setDragPoint(null);
      if (doc === undefined) return;
      // Hit test the object under the release point (topmost first; never
      // this connector itself).
      const others = (props.objects ?? []).filter((o) => o.id !== props.id);
      const hit = [...others]
        .reverse()
        .find((o) => getObjectType(o.type)?.hitTest(o, p, zoom));
      let ep: Endpoint;
      if (hit !== undefined) {
        const box = objectBounds(hit);
        const otherPoint: Point =
          end === 'from' ? (toPoint ?? p) : (fromPoint ?? p);
        const side = nearestSide(box, otherPoint);
        ep = { kind: 'attached', objectId: hit.id, fallback: sideAnchor(box, side) };
      } else {
        ep = { kind: 'free', x: p.x, y: p.y };
      }
      props.onBoundary?.();
      // Rejections (stale id / same object at the other end / non-finite)
      // leave the endpoint untouched — the handle snaps back.
      setConnectorEndpoint(doc, props.id, end, ep);
      props.onBoundary?.();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragEnd, camera, doc, props.id, props.objects, props.onBoundary, fromPoint, toPoint, zoom]);

  const startHandleDrag = (end: 'from' | 'to') => (e: ReactPointerEvent<SVGCircleElement>): void => {
    if (e.button !== 0 || readOnly || doc === undefined) return;
    // The handle must not trigger the object's move gesture.
    e.stopPropagation();
    e.preventDefault();
    setDragPoint(screenToWorld(camera, { x: e.clientX, y: e.clientY }));
    setDragEnd(end);
  };

  // Display endpoints (the dragged end follows the pointer locally).
  const dispFrom = dragEnd === 'from' && dragPoint !== null ? dragPoint : fromPoint;
  const dispTo = dragEnd === 'to' && dragPoint !== null ? dragPoint : toPoint;

  // The svg box: the endpoint bbox padded in screen space (so the arrowhead
  // and handles are never clipped, at any zoom).
  const pad = (CONNECTOR_ARROWHEAD_SIZE_WORLD + CONNECTOR_HIT_TOLERANCE_PX) / zoom + 2;
  const boxX = Math.min(dispFrom.x, dispTo.x) - pad;
  const boxY = Math.min(dispFrom.y, dispTo.y) - pad;
  const boxW = Math.abs(dispTo.x - dispFrom.x) + pad * 2;
  const boxH = Math.abs(dispTo.y - dispFrom.y) + pad * 2;
  const fx = dispFrom.x - boxX;
  const fy = dispFrom.y - boxY;
  const tx = dispTo.x - boxX;
  const ty = dispTo.y - boxY;
  const color = selected ? SELECT_COLOR : LINE_COLOR;
  const markerId = `conn-ah-${props.id}`;

  return (
    <div
      data-testid="connector"
      data-id={props.id}
      data-selected={selected ? true : undefined}
      style={{
        position: 'absolute',
        left: boxX,
        top: boxY,
        width: boxW,
        height: boxH,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={boxW}
        height={boxH}
        style={{ position: 'absolute', left: 0, top: 0, display: 'block', overflow: 'visible' }}
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            markerHeight={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
          </marker>
        </defs>
        {/* Invisible fat hit line: 2 x tolerance screen px, at any zoom. */}
        <line
          data-testid="connector-hit"
          x1={fx}
          y1={fy}
          x2={tx}
          y2={ty}
          stroke="transparent"
          strokeWidth={(2 * CONNECTOR_HIT_TOLERANCE_PX) / zoom}
          style={{ pointerEvents: 'stroke', cursor: 'move' }}
          onPointerDown={(e) => {
            if (readOnly) return;
            props.onObjectPointerDown?.(e);
          }}
        />
        <line
          data-testid="connector-line"
          x1={fx}
          y1={fy}
          x2={tx}
          y2={ty}
          stroke={color}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          markerEnd={`url(#${markerId})`}
          style={{ pointerEvents: 'none' }}
        />
        {selected && !readOnly && doc !== undefined && (
          <>
            <circle
              data-testid="connector-handle-from"
              cx={fx}
              cy={fy}
              r={CONNECTOR_DOT_RADIUS_PX / zoom + 2 / zoom}
              fill="#ffffff"
              stroke={SELECT_COLOR}
              strokeWidth={2 / zoom}
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={startHandleDrag('from')}
            />
            <circle
              data-testid="connector-handle-to"
              cx={tx}
              cy={ty}
              r={CONNECTOR_DOT_RADIUS_PX / zoom + 2 / zoom}
              fill="#ffffff"
              stroke={SELECT_COLOR}
              strokeWidth={2 / zoom}
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onPointerDown={startHandleDrag('to')}
            />
          </>
        )}
      </svg>
    </div>
  );
}
