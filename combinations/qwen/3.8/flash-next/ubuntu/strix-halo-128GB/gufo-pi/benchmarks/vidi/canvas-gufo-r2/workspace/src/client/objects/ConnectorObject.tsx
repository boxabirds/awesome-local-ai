/**
 * Connector object rendering (story 10).
 */
import { useCallback, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
} from '../../shared/config';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { setConnectorEndpoint, type Endpoint } from '../../shared/objects/connector';
import type { ObjectProps } from './registry';
import type { Rect, Point } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface ConnectorProps extends ObjectProps {
  rects?: ReadonlyMap<string, Rect>;
  snapshot?: readonly ObjectSnapshot[];
  getCamera?: () => { x: number; y: number; zoom: number };
}

export function ConnectorObject(props: ConnectorProps): JSX.Element {
  const { obj, doc, selected, zoom } = props;
  const rects = props.rects ?? new Map<string, Rect>();
  const fromEp = obj.from as Endpoint | undefined;
  const toEp = obj.to as Endpoint | undefined;

  if (!fromEp || !toEp) {
    return <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'visible' }} />;
  }

  const resolved = resolveEndpoints({ from: fromEp, to: toEp }, rects);
  const { from: fp, to: tp } = resolved;

  const pad = CONNECTOR_ARROWHEAD_SIZE_WORLD + CONNECTOR_STROKE_WIDTH_WORLD;
  const minX = Math.min(fp.x, tp.x) - pad;
  const minY = Math.min(fp.y, tp.y) - pad;
  const svgW = Math.abs(tp.x - fp.x) + 2 * pad;
  const svgH = Math.abs(tp.y - fp.y) + 2 * pad;

  const lx1 = fp.x - minX;
  const ly1 = fp.y - minY;
  const lx2 = tp.x - minX;
  const ly2 = tp.y - minY;

  const arrowId = `arrowhead-${obj.id}`;

  return (
    <div
      className="connector-object"
      role="img"
      aria-label="Arrow connector"
      data-connector-id={obj.id}
      data-selected={selected ? 'true' : undefined}
      style={{
        position: 'absolute',
        left: `${minX}px`,
        top: `${minY}px`,
        width: `${svgW}px`,
        height: `${svgH}px`,
        zIndex: obj.z,
        pointerEvents: 'none',
      }}
    >
      <svg width={svgW} height={svgH} style={{ overflow: 'visible' }}>
        <defs>
          <marker
            id={arrowId}
            markerWidth={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            markerHeight={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            refX={CONNECTOR_ARROWHEAD_SIZE_WORLD}
            refY={CONNECTOR_ARROWHEAD_SIZE_WORLD / 2}
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path
              d={`M 0 0 L ${CONNECTOR_ARROWHEAD_SIZE_WORLD} ${CONNECTOR_ARROWHEAD_SIZE_WORLD / 2} L 0 ${CONNECTOR_ARROWHEAD_SIZE_WORLD} Z`}
              fill="#263238"
            />
          </marker>
        </defs>
        <line
          x1={lx1} y1={ly1} x2={lx2} y2={ly2}
          stroke="transparent"
          strokeWidth={CONNECTOR_HIT_TOLERANCE_PX * 2 / zoom}
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
          onPointerDown={(e) => {
            if (props.readOnly) return;
            props.onObjectPointerDown(e, obj.id);
          }}
        />
        <line
          x1={lx1} y1={ly1} x2={lx2} y2={ly2}
          stroke="#263238"
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          markerEnd={`url(#${arrowId})`}
          style={{ pointerEvents: 'none' }}
        />
      </svg>
      {selected && !props.readOnly && (
        <>
          <ConnectorEndHandle
            x={fp.x} y={fp.y}
            end="from"
            objId={obj.id}
            doc={doc}
            rects={rects}
            snapshot={props.snapshot ?? []}
            zoom={zoom}
            getCamera={props.getCamera}
            undo={props.undo}
          />
          <ConnectorEndHandle
            x={tp.x} y={tp.y}
            end="to"
            objId={obj.id}
            doc={doc}
            rects={rects}
            snapshot={props.snapshot ?? []}
            zoom={zoom}
            getCamera={props.getCamera}
            undo={props.undo}
          />
        </>
      )}
    </div>
  );
}

function ConnectorEndHandle(props: {
  x: number;
  y: number;
  end: 'from' | 'to';
  objId: string;
  doc: Y.Doc;
  rects: ReadonlyMap<string, Rect>;
  snapshot: readonly ObjectSnapshot[];
  zoom: number;
  getCamera?: () => { x: number; y: number; zoom: number };
  undo?: { boundary(): void };
}): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<Point | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      const cam = props.getCamera?.();
      if (cam) {
        const board = document.querySelector('[data-testid="board"]') as HTMLElement | null;
        const rect = board?.getBoundingClientRect();
        const sx = ev.clientX - (rect?.left ?? 0);
        const sy = ev.clientY - (rect?.top ?? 0);
        setDragPos({ x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y });
      }
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragging(false);
      setDragPos(null);

      const cam = props.getCamera?.();
      let worldPt: Point;
      if (cam) {
        const board = document.querySelector('[data-testid="board"]') as HTMLElement | null;
        const rect = board?.getBoundingClientRect();
        const sx = ev.clientX - (rect?.left ?? 0);
        const sy = ev.clientY - (rect?.top ?? 0);
        worldPt = { x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y };
      } else {
        worldPt = { x: props.x, y: props.y };
      }

      const target = hitTestObject(worldPt, props.snapshot, props.objId);
      props.undo?.boundary();

      if (target) {
        const objectsMap = props.doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
        const conn = objectsMap.get(props.objId);
        if (conn) {
          const otherKey = props.end === 'from' ? 'to' : 'from';
          const otherEp = conn.get(otherKey) as Endpoint | undefined;
          if (otherEp && otherEp.kind === 'attached' && otherEp.objectId === target.id) {
            return; // snap back
          }
        }
        const r = props.rects.get(target.id) ?? { x: target.x, y: target.y, width: (target.width ?? 200), height: (target.height ?? 200) };
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const newEp: Endpoint = { kind: 'attached', objectId: target.id, fallback: { x: cx, y: cy } };
        setConnectorEndpoint(props.doc, props.objId, props.end, newEp);
      } else {
        const newEp: Endpoint = { kind: 'free', x: worldPt.x, y: worldPt.y };
        setConnectorEndpoint(props.doc, props.objId, props.end, newEp);
      }
      props.undo?.boundary();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [props]);

  const renderX = dragging && dragPos ? dragPos.x : props.x;
  const renderY = dragging && dragPos ? dragPos.y : props.y;

  return (
    <div
      className="connector-end-handle"
      data-connector-end={props.end}
      style={{
        position: 'absolute',
        left: `${renderX - Math.min(props.x, props.getCamera ? 0 : 0)}px`,
        top: `${renderY - Math.min(props.y, props.getCamera ? 0 : 0)}px`,
        width: '10px',
        height: '10px',
        marginLeft: '-5px',
        marginTop: '-5px',
        backgroundColor: '#4A90D9',
        border: '2px solid white',
        borderRadius: '50%',
        cursor: 'crosshair',
        pointerEvents: 'auto',
        zIndex: 10,
      }}
      onPointerDown={handlePointerDown}
    />
  );
}

function hitTestObject(
  worldPt: Point,
  snapshot: readonly ObjectSnapshot[],
  excludeId: string,
): ObjectSnapshot | null {
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const o = snapshot[i];
    if (o.id === excludeId) continue;
    if (o.type === 'connector') continue;
    const w = o.width ?? 200;
    const h = o.height ?? 200;
    if (worldPt.x >= o.x && worldPt.x <= o.x + w && worldPt.y >= o.y && worldPt.y <= o.y + h) {
      return o;
    }
  }
  return null;
}
