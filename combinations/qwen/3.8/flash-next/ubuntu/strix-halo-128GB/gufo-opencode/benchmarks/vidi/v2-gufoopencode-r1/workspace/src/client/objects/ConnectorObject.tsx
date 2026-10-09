import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, JSX } from 'react';
import { isConnectorObject, LOCAL_ORIGIN } from '../../shared/board-model';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_COLOR,
  CONNECTOR_STROKE_WIDTH_WORLD
} from '../../shared/config';
import { setConnectorEndpoint, type EndSide } from '../../shared/objects/connector';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';

// Story 10 renderer (design connector.render): an arrow between the two
// resolved endpoints, redrawn from the snapshot on every move/resize by anyone.
// Detached/orphaned ends render at their stored points. When selected it shows
// two end handles that re-attach (or release) on drag.
export function ConnectorObject(props: ObjectProps): JSX.Element {
  const { obj, doc, zoom, selected } = props;
  const undo = useUndoController();
  const draggingHandle = useRef<EndSide | null>(null);

  const resolved = isConnectorObject(obj) ? obj.resolved : { from: { x: obj.x, y: obj.y }, to: { x: obj.x, y: obj.y } };
  const from = resolved.from;
  const to = resolved.to;
  const z = zoom > 0 ? zoom : 1;
  const margin = CONNECTOR_ARROWHEAD_SIZE_WORLD + 8 / z;
  const minX = Math.min(from.x, to.x) - margin;
  const minY = Math.min(from.y, to.y) - margin;
  const width = Math.abs(to.x - from.x) + margin * 2;
  const height = Math.abs(to.y - from.y) + margin * 2;
  const lx = (p: { x: number }): number => p.x - minX;
  const ly = (p: { y: number }): number => p.y - minY;
  const markerId = `arrowhead-${obj.id}`;

  const endObject = (end: 'from' | 'to'): string | undefined => {
    if (!isConnectorObject(obj)) return undefined;
    const ep = obj[end];
    return ep.kind === 'attached' ? ep.objectId : undefined;
  };

  const select = (event: ReactPointerEvent<SVGElement>): void => {
    event.stopPropagation();
    props.onSelect?.(obj.id);
  };

  const beginHandle = (end: EndSide) => (event: ReactPointerEvent<SVGCircleElement>): void => {
    if (!props.editable) return;
    event.stopPropagation();
    draggingHandle.current = end;
    try {
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    } catch {
      // jsdom and older browsers: window-level pointer events still drive the drag.
    }
  };

  const moveHandle = (_end: EndSide) => (_event: ReactPointerEvent<SVGCircleElement>): void => {
    // The dot stays pinned to its current anchor until release; no in-progress
    // writes (a release over a target or empty space is one transaction).
  };

  const endHandle = (end: EndSide) => (event: ReactPointerEvent<SVGCircleElement>): void => {
    if (draggingHandle.current !== end) return;
    draggingHandle.current = null;
    const world = props.screenToWorld?.(event.clientX, event.clientY);
    if (world === undefined) return;
    const opposite = endObject(end === 'from' ? 'to' : 'from');
    const target = props.hitTestAtWorld?.(world, opposite) ?? null;
    undo?.boundary();
    doc.transact(() => {
      if (target !== null) {
        setConnectorEndpoint(doc, obj.id, end, { kind: 'attached', objectId: target });
      } else {
        setConnectorEndpoint(doc, obj.id, end, { kind: 'free', x: world.x, y: world.y });
      }
    }, LOCAL_ORIGIN);
    undo?.boundary();
  };

  const handleRadius = CONNECTOR_DOT_RADIUS_PX / z;
  const hitWidth = (CONNECTOR_HIT_TOLERANCE_PX * 2) / z;

  return (
    <div
      data-testid={`connector-${obj.id}`}
      data-from-x={from.x}
      data-from-y={from.y}
      data-to-x={to.x}
      data-to-y={to.y}
      data-selected={selected}
      style={{
        position: 'absolute',
        left: minX,
        top: minY,
        width,
        height,
        pointerEvents: 'none',
        zIndex: obj.z
      }}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
        <defs>
          <marker
            id={markerId}
            markerUnits="userSpaceOnUse"
            markerWidth={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            markerHeight={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            refX={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            refY={CONNECTOR_ARROWHEAD_SIZE_WORLD / 2}
            orient="auto"
          >
            <path
              d={`M0 0 L${CONNECTOR_ARROWHEAD_SIZE_WORLD} ${CONNECTOR_ARROWHEAD_SIZE_WORLD / 2} L0 ${CONNECTOR_ARROWHEAD_SIZE_WORLD} Z`}
              fill={CONNECTOR_STROKE_COLOR}
            />
          </marker>
        </defs>
        <line
          data-testid={`connector-hit-${obj.id}`}
          x1={lx(from)}
          y1={ly(from)}
          x2={lx(to)}
          y2={ly(to)}
          stroke="transparent"
          strokeWidth={hitWidth}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={select}
        />
        <line
          x1={lx(from)}
          y1={ly(from)}
          x2={lx(to)}
          y2={ly(to)}
          stroke={CONNECTOR_STROKE_COLOR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          markerEnd={`url(#${markerId})`}
          style={{ pointerEvents: 'none' }}
        />
        {selected && props.editable
          ? (['from', 'to'] as const).map((end) => {
              const p = end === 'from' ? from : to;
              return (
                <circle
                  key={end}
                  data-testid={`connector-handle-${end}-${obj.id}`}
                  cx={lx(p)}
                  cy={ly(p)}
                  r={handleRadius}
                  fill="#ffffff"
                  stroke={CONNECTOR_STROKE_COLOR}
                  strokeWidth={handleRadius}
                  style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
                  onPointerDown={beginHandle(end)}
                  onPointerMove={moveHandle(end)}
                  onPointerUp={endHandle(end)}
                  onPointerCancel={() => {
                    draggingHandle.current = null;
                  }}
                />
              );
            })
          : null}
      </svg>
    </div>
  );
}
