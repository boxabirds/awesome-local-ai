// One arrow on the board (story 10, connector.*).
//
// It is a renderer and a handle host, and nothing else: selecting, moving, deleting and
// undo arrive through the registry from stories 7 and 8, so an arrow is chosen by the same
// gestures as a note and removed by the same delete (connector.consistent).
//
// The line itself is not stored. The document holds two endpoints — each one an object, or
// one point in space — and this component draws what they mean *now*: `endpoints` is the
// resolved line, derived by the same function the model measures, at the screen position
// each world point currently has. That is why an arrow follows a shape it points at with no
// animation code, no second write and nothing sent to anyone (Key decision 2).
//
// Two numbers keep the drawing honest at every zoom: the line's width is in *world* units,
// because an arrow is part of the board and scales with it; the dots and the handles are
// divided by the zoom, because they are things a person aims at and must stay the size of a
// fingertip at 25% as much as at 400%.

import { type PointerEvent as ReactPointerEvent } from 'react';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_COLOR,
  CONNECTOR_HANDLE_SIZE_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import type { ConnectorEnd } from '../../shared/objects/connector';
import type { Point } from '../../shared/geometry';
import { isEndpoint } from '../../shared/geometry';
import type { ConnectorSnap } from '../../shared/objects/connector';
import type { ObjectProps } from './registry';

export type ConnectorObjectProps = ObjectProps;

/** A screen-pixel size expressed in world units at this zoom. */
function worldPx(px: number, zoom: number): number {
  return px / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
}

function isDrawable(p: Point | undefined | null): p is Point {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * The arrowhead: a filled triangle at the `to` end, computed from the direction of the
 * line that runs into it. Filled rather than a stroke marker, because the head is the same
 * colour as the shaft, must not scale with the stroke and has to be one element a test can
 * find (connector.arrowhead).
 */
function arrowhead(from: Point, to: Point, size: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = to.x - ux * size;
  const by = to.y - uy * size;
  // Square to the shaft, so the head is a wedge and not a smudge.
  const px = -uy * (size / 2);
  const py = ux * (size / 2);
  return `${to.x},${to.y} ${bx + px},${by + py} ${bx - px},${by - py}`;
}

export function ConnectorObject(props: ConnectorObjectProps) {
  const { obj, zoom, selected, onObjectPointerDown, onConnectorEndPointerDown } = props;
  const connector = obj as ConnectorSnap;
  const a = connector.endpoints.from;
  const b = connector.endpoints.to;
  if (!isDrawable(a) || !isDrawable(b)) return null; // nothing to draw, nothing to hit

  const sw = CONNECTOR_STROKE_WIDTH_WORLD;
  const head = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  // Room for the arrowhead, the handles and the stroke, so nothing this object draws is
  // clipped by its own element. Story 7 frames the selection from the snapshot's box, not
  // from this element, so the padding is paint only.
  const pad = head + sw * 2 + worldPx(CONNECTOR_HANDLE_SIZE_PX, zoom);
  const left = Math.min(a.x, b.x) - pad;
  const top = Math.min(a.y, b.y) - pad;
  const w = Math.abs(a.x - b.x) + pad * 2;
  const h = Math.abs(a.y - b.y) + pad * 2;

  const handleR = worldPx(CONNECTOR_HANDLE_SIZE_PX / 2, zoom);
  // The line plus the screen allowance either side, in world units at this zoom: what a
  // person has to hit is the arrow, not a hairline (connector.select).
  const hitW = worldPx(CONNECTOR_HIT_TOLERANCE_PX * 2, zoom) + sw;

  const stopMouse = (e: { stopPropagation(): void }) => e.stopPropagation();
  const press = (e: ReactPointerEvent<Element>, end?: ConnectorEnd) => {
    e.stopPropagation();
    if (end && selected && onConnectorEndPointerDown) {
      onConnectorEndPointerDown(e, connector.id, end);
      return;
    }
    onObjectPointerDown(e as ReactPointerEvent<HTMLElement>, connector.id);
  };

  /** What an end is joined to, in words a screen reader can say (accessibility). */
  const endName = (end: ConnectorSnap['from']): string =>
    isEndpoint(end) ? 'an object' : 'a point on the board';

  return (
    <div
      role="group"
      aria-label={`Connector from ${endName(connector.from)} to ${endName(connector.to)}`}
      data-connector-id={connector.id}
      data-object-id={connector.id}
      data-selected={selected ? 'true' : 'false'}
      data-testid={`connector-${connector.id}`}
      tabIndex={0}
      className="connector-object"
      style={{
        position: 'absolute',
        left,
        top,
        width: w,
        height: h,
        zIndex: connector.z,
        // Only the line and the handles take presses: the box around them is empty board
        // and must stay clickable, or an arrow would swallow half the board.
        pointerEvents: 'none',
      }}
      onDoubleClick={stopMouse} // an arrow has no label to edit
    >
      <svg
        width={w}
        height={h}
        viewBox={`${left} ${top} ${w} ${h}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        aria-hidden="true"
      >
        {/* The hit target first, so the visible line and head never steal a press from it. */}
        <line
          data-testid={`connector-hit-${connector.id}`}
          data-connector-hit="true"
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke="transparent"
          strokeWidth={hitW}
          style={{ pointerEvents: 'stroke', cursor: 'default' }}
          onPointerDown={(e) => press(e)}
        />
        <line
          data-testid={`connector-line-${connector.id}`}
          data-connector-line="true"
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={CONNECTOR_COLOR}
          strokeWidth={sw}
          strokeLinecap="round"
        />
        <polygon
          data-testid={`connector-head-${connector.id}`}
          data-connector-head="true"
          points={arrowhead(a, b, head)}
          fill={CONNECTOR_COLOR}
          stroke="none"
        />
        {/* The two ends, drawn while the arrow is selected: what the end is joined to is a
            dot, and it is also a handle a person can drag somewhere else (connector.handles). */}
        {selected
          ? (['from', 'to'] as const).map((end) => {
              const p = end === 'from' ? a : b;
              return (
                <circle
                  key={end}
                  data-testid={`connector-handle-${end}-${connector.id}`}
                  data-connector-handle={end}
                  cx={p.x}
                  cy={p.y}
                  r={handleR}
                  fill={CONNECTOR_COLOR}
                  stroke="#ffffff"
                  strokeWidth={sw}
                  style={{ pointerEvents: 'all', cursor: 'grab' }}
                  onPointerDown={(e) => press(e, end)}
                />
              );
            })
          : null}
      </svg>
    </div>
  );
}
