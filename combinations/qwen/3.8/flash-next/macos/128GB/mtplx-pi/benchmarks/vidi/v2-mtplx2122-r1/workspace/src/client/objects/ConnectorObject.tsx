import React from 'react'
import type { ConnectorSnap } from '../../shared/objects/connector'
import type { Rect, Point } from '../../shared/geometry/types'
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
} from '../../shared/config'
import { distanceToPolyline } from '../../shared/geometry/polyline'
import { resolveEndpoints } from '../../shared/geometry/connector-geometry'

export interface ConnectorObjectProps {
  connector: ConnectorSnap
  rects: ReadonlyMap<string, Rect>
  zoom: number
  selected: boolean
  onSelect(id: string): void
}

/**
 * Precise arrow hit-test (connector.select): true when `p` is within
 * CONNECTOR_HIT_TOLERANCE_PX *screen* pixels of the arrow's line. The world
 * distance threshold is the pixel tolerance divided by `zoom`.
 */
export function hitTestConnector(
  connector: ConnectorSnap,
  rects: ReadonlyMap<string, Rect>,
  p: Point,
  zoom: number,
): boolean {
  const { from, to } = resolveEndpoints(
    { from: connector.from, to: connector.to },
    rects,
  )
  const dist = distanceToPolyline([from, to], p)
  return dist <= CONNECTOR_HIT_TOLERANCE_PX / zoom
}

const STROKE_COLOR = '#263238'
const HIT_COLOR = 'rgba(0,0,0,0)' // transparent but hittable via pointer-events

/**
 * A single arrow. Endpoints are recomputed from the live `rects` every render
 * (via ConnectorSnap's resolved points, which use the same rule), so moves and
 * resizes by any person redraw it and switch sides — with no extra writes.
 * When selected it shows a small handle at each end (re-attach in the browser).
 */
export function ConnectorObject({
  connector,
  zoom,
  selected,
  onSelect,
}: ConnectorObjectProps) {
  const { fromPoint: from, toPoint: to } = connector

  // Draw inside a padded, screen-independent box around the line.
  const pad = (CONNECTOR_ARROWHEAD_SIZE_WORLD + CONNECTOR_HIT_TOLERANCE_PX / Math.max(zoom, 0.0001))
  const x = Math.min(from.x, to.x) - pad
  const y = Math.min(from.y, to.y) - pad
  const w = Math.abs(from.x - to.x) + pad * 2
  const h = Math.abs(from.y - to.y) + pad * 2
  // Local coordinates of the two endpoints inside the padded svg box.
  const lx0 = from.x - x
  const ly0 = from.y - y
  const lx1 = to.x - x
  const ly1 = to.y - y

  const hitWidth = (CONNECTOR_HIT_TOLERANCE_PX * 2) / Math.max(zoom, 0.0001)

  function handleSelect(e: React.PointerEvent) {
    e.stopPropagation()
    onSelect(connector.id)
  }

  return (
    <svg
      data-testid="connector-object"
      data-connector-id={connector.id}
      role="img"
      aria-label={selected ? 'Connector arrow, selected' : 'Connector arrow'}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {/* Wide transparent stroke: the real pointer target in the browser. */}
      <line
        x1={lx0}
        y1={ly0}
        x2={lx1}
        y2={ly1}
        stroke={HIT_COLOR}
        strokeWidth={hitWidth}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onPointerDown={handleSelect}
      />
      <line
        x1={lx0}
        y1={ly0}
        x2={lx1}
        y2={ly1}
        stroke={STROKE_COLOR}
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        markerEnd="url(#connector-arrowhead)"
        style={{ pointerEvents: 'none' }}
      />
      <defs>
        <marker
          id="connector-arrowhead"
          markerWidth={CONNECTOR_ARROWHEAD_SIZE_WORLD}
          markerHeight={CONNECTOR_ARROWHEAD_SIZE_WORLD}
          refX={CONNECTOR_ARROWHEAD_SIZE_WORLD}
          refY={CONNECTOR_ARROWHEAD_SIZE_WORLD / 2}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <polygon
            points={`0,0 ${CONNECTOR_ARROWHEAD_SIZE_WORLD},${CONNECTOR_ARROWHEAD_SIZE_WORLD / 2} 0,${CONNECTOR_ARROWHEAD_SIZE_WORLD}`}
            fill={STROKE_COLOR}
          />
        </marker>
      </defs>
      {selected && (
        <>
          <circle data-testid="connector-handle-from" cx={lx0} cy={ly0} r={5 / zoom}
            fill="#4285f4" style={{ pointerEvents: 'none' }} />
          <circle data-testid="connector-handle-to" cx={lx1} cy={ly1} r={5 / zoom}
            fill="#4285f4" style={{ pointerEvents: 'none' }} />
        </>
      )}
    </svg>
  )
}
