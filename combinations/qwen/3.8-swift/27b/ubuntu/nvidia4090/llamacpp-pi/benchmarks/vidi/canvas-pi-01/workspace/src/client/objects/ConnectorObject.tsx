// Connector (arrow) object (see spec: connector.ui, connector.object).
//
// Rendered in world space as an SVG line with an arrowhead marker
// (CONNECTOR_ARROWHEAD_SIZE_WORLD, CONNECTOR_STROKE_WIDTH_WORLD). The
// endpoints are resolved from the live object rects on every render
// (`resolveEndpoints`), so moves and resizes by anyone redraw attached
// arrows without writes; detached/orphaned ends draw at their stored points.
//
// Clicking the arrow selects it: the wide invisible hit line is
// 2 * CONNECTOR_HIT_TOLERANCE_PX / zoom world units thick, i.e. exactly
// CONNECTOR_HIT_TOLERANCE_PX screen pixels at the current zoom (story 10's
// tolerance; TC-20). When selected, the two end handles are shown; dragging
// one re-attaches (over an object → attached, over empty space → free, over
// the opposite end's object → setConnectorEndpoint rejects and it snaps
// back) — connector.reattach.

import { useState, type JSX } from 'react';
import * as Y from 'yjs';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import {
  resolveEndpoints,
  type Endpoint,
} from '../../shared/geometry/connector-geometry';
import { pointInRect, type Point, type Rect } from '../../shared/geometry';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import {
  setConnectorEndpoint,
  type ConnectorSnap,
} from '../../shared/objects/connector';
import { screenToWorld, type Camera } from '../canvas/camera';
import type { UndoController } from '../board/undo';

export interface ConnectorObjectProps {
  connector: ConnectorSnap;
  /** Every object's snapshot (hit-testing on handle release). */
  snapshot: readonly ObjectSnapshot[];
  /** Live rects of every attachable object (endpoint resolution). */
  rects: ReadonlyMap<string, Rect>;
  doc: Y.Doc;
  camera: Camera | null;
  zoom: number;
  selected: boolean;
  editable: boolean;
  onObjectPointerDown(e: React.PointerEvent<HTMLElement>, id: string): void;
  onFocusSelect(id: string): void;
  undo?: UndoController | null;
}

type EndKey = 'from' | 'to';

/** The frontmost non-connector object whose bounds contain `world` (or null). */
function objectUnder(
  snapshot: readonly ObjectSnapshot[],
  world: Point,
  selfId: string,
): ObjectSnapshot | null {
  let best: ObjectSnapshot | null = null;
  let bestZ = -Infinity;
  for (const n of snapshot) {
    if (n.id === selfId || n.type === 'connector') continue;
    if (!pointInRect(objectBounds(n), world)) continue;
    if (n.z > bestZ) {
      best = n;
      bestZ = n.z;
    }
  }
  return best;
}

export function ConnectorObject({
  connector,
  snapshot,
  rects,
  doc,
  camera,
  zoom,
  selected,
  editable,
  onObjectPointerDown,
  onFocusSelect,
  undo,
}: ConnectorObjectProps): JSX.Element {
  const [drag, setDrag] = useState<{ end: EndKey; point: Point } | null>(null);

  const resolved = resolveEndpoints(connector, rects);
  const from = resolved.from;
  const to = resolved.to;

  // While dragging an end, that end follows the pointer.
  const a = drag !== null && drag.end === 'from' ? drag.point : from;
  const b = drag !== null && drag.end === 'to' ? drag.point : to;

  const hitStroke = (2 * CONNECTOR_HIT_TOLERANCE_PX) / zoom;

  /** Event position in viewport coordinates (CSS px from the board-viewport
   *  top-left), for screenToWorld. */
  const toViewport = (event: { clientX: number; clientY: number }): Point | null => {
    if (camera === null) return null;
    const vp = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
    if (vp === null) return { x: event.clientX, y: event.clientY };
    const rect = vp.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startHandleDrag =
    (end: EndKey) => (event: React.PointerEvent<SVGCircleElement>) => {
      if (!editable) return;
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture unsupported (e.g. jsdom) — drag still works.
      }
      setDrag({ end, point: end === 'from' ? from : to });
    };

  const onHandleMove = (event: React.PointerEvent<SVGCircleElement>) => {
    if (drag === null) return;
    const vp = toViewport(event);
    if (vp === null || camera === null) return;
    setDrag({ end: drag.end, point: screenToWorld(camera, vp) });
  };

  const onHandleUp = (event: React.PointerEvent<SVGCircleElement>) => {
    if (drag === null) return;
    const end = drag.end;
    setDrag(null);
    const vp = toViewport(event);
    if (vp === null || camera === null) return;
    const world = screenToWorld(camera, vp);
    const target = objectUnder(snapshot, world, connector.id);
    const next: Endpoint =
      target === null
        ? { kind: 'free', x: world.x, y: world.y }
        : { kind: 'attached', objectId: target.id, fallback: world };
    if (setConnectorEndpoint(doc, connector.id, end, next)) {
      undo?.boundary();
    }
    // Rejected (opposite end's object / stale id): nothing written — the
    // end snaps back to its previous position.
  };

  return (
    <svg
      data-testid="connector-object"
      data-id={connector.id}
      role="img"
      aria-label="Connector arrow"
      className="connector-object"
      data-selected={selected || undefined}
      tabIndex={0}
      onFocus={() => {
        if (!selected && drag === null) onFocusSelect(connector.id);
      }}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      <defs>
        <marker
          id={`arrowhead-${connector.id}`}
          markerUnits="userSpaceOnUse"
          markerWidth={CONNECTOR_ARROWHEAD_SIZE_WORLD}
          markerHeight={CONNECTOR_ARROWHEAD_SIZE_WORLD}
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#334155" />
        </marker>
      </defs>
      {/* Wide invisible hit line: exactly the click tolerance on screen. */}
      <line
        data-testid="connector-hit"
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="transparent"
        strokeWidth={hitStroke}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onPointerDown={(e) =>
          onObjectPointerDown(e as unknown as React.PointerEvent<HTMLElement>, connector.id)
        }
      />
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="#334155"
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        markerEnd={`url(#arrowhead-${connector.id})`}
      />
      {selected && editable && (
        <>
          <circle
            data-testid="connector-handle-from"
            cx={a.x}
            cy={a.y}
            r={6 / zoom}
            className="connector-handle"
            style={{ pointerEvents: 'all', cursor: 'grab' }}
            onPointerDown={startHandleDrag('from')}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={() => setDrag(null)}
          />
          <circle
            data-testid="connector-handle-to"
            cx={b.x}
            cy={b.y}
            r={6 / zoom}
            className="connector-handle"
            style={{ pointerEvents: 'all', cursor: 'grab' }}
            onPointerDown={startHandleDrag('to')}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={() => setDrag(null)}
          />
        </>
      )}
    </svg>
  );
}
