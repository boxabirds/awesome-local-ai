/**
 * ConnectorObject (story 10): renders an arrow between two resolved endpoints.
 *
 * The arrow is a single SVG placed at the world origin (overflow visible) so
 * it can span the whole board. The visible line plus arrowhead are drawn from
 * `resolveEndpoints(connector, rects)` — recomputed on every snapshot, which
 * is what makes arrows follow when objects move (locally or remotely).
 *
 * Selection: the line has a wide transparent hit stroke
 * (2 * CONNECTOR_HIT_TOLERANCE_PX screen px, converted with the zoom) so
 * clicking within ~6 px of the line selects the arrow.
 *
 * When selected, two endpoint handles are shown; dragging one re-attaches it
 * to the object under the pointer (setConnectorEndpoint) or drops it as a free
 * point.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import {
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { screenToWorld, type Camera } from '../canvas/camera';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { getObjectType } from '../objects/registry';
import {
  setConnectorEndpoint,
} from '../../shared/objects/connector';
import type { ConnectorSnapshot, ObjectSnapshot } from '../../shared/board-model';

export interface ConnectorObjectProps {
  connector: ConnectorSnapshot;
  /** Current bounds of all objects (for endpoint resolution and hit tests). */
  rects: ReadonlyMap<string, Rect>;
  /** Current object snapshots (for hit tests on handle release). */
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  selected: boolean;
  zoom: number;
  camera: Camera;
  onPointerDown(e: React.PointerEvent, id: string): void;
  onBoundary?(): void;
}

const ARROW_COLOR = '#263238';

/** The topmost non-connector object whose hit test contains `world`, if any. */
export function hitObjectAt(
  snapshot: readonly ObjectSnapshot[],
  world: Point,
  zoom: number,
  rects: ReadonlyMap<string, Rect>,
): ObjectSnapshot | null {
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const s = snapshot[i];
    if (s.type === 'connector') continue;
    const spec = getObjectType(s.type);
    if (spec?.hitTest(s, world, zoom, rects)) return s;
  }
  return null;
}

export function ConnectorObject(props: ConnectorObjectProps): JSX.Element {
  const { connector, rects, snapshot, doc, selected, zoom, camera } = props;
  const ends = resolveEndpoints(connector, rects);
  const { from, to } = ends;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);

  // Arrowhead: tip at `to`, base perpendicular at distance arrowSize behind.
  const a = CONNECTOR_ARROWHEAD_SIZE_WORLD;
  const baseX = to.x - a * Math.cos(angle);
  const baseY = to.y - a * Math.sin(angle);
  const px = -Math.sin(angle);
  const py = Math.cos(angle);
  const half = a / 2;
  const arrowPoints = [
    `${to.x},${to.y}`,
    `${baseX + half * px},${baseY + half * py}`,
    `${baseX - half * px},${baseY - half * py}`,
  ].join(' ');

  // Hit stroke width in world units: visible width + 2*tolerance (screen px).
  const hitWidth = CONNECTOR_STROKE_WIDTH_WORLD + (2 * CONNECTOR_HIT_TOLERANCE_PX) / zoom;

  const camRef = useRef(camera);
  camRef.current = camera;

  // --- Endpoint handle dragging (re-attach) ---
  const [draggingEnd, setDraggingEnd] = useState<null | 'from' | 'to'>(null);
  const [dragScreen, setDragScreen] = useState<Point | null>(null);
  const dragEndRef = useRef<null | 'from' | 'to'>(null);

  const startHandleDrag = (end: 'from' | 'to') => (e: React.PointerEvent) => {
    e.stopPropagation();
    dragEndRef.current = end;
    setDraggingEnd(end);
    setDragScreen({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!draggingEnd) return;
    const move = (e: PointerEvent) => {
      setDragScreen({ x: e.clientX, y: e.clientY });
    };
    const up = (e: PointerEvent) => {
      const end = dragEndRef.current;
      const world = screenToWorld(camRef.current, { x: e.clientX, y: e.clientY });
      if (end) {
        const other = end === 'from' ? connector.to : connector.from;
        const target = hitObjectAt(snapshot, world, zoom, rects);
        const otherId = other.kind === 'attached' ? other.objectId : null;
        let ok = false;
        if (target && target.id !== otherId) {
          // Re-attach; the model resolves the anchor against the live doc.
          ok = setConnectorEndpoint(doc, connector.id, end, {
            kind: 'attached',
            objectId: target.id,
            fallback: { x: world.x, y: world.y },
          });
        } else if (!target) {
          // Drop as a free point.
          ok = setConnectorEndpoint(doc, connector.id, end, { kind: 'free', x: world.x, y: world.y });
        }
        // Dropped on the other end's own object: snap back (no write).
        if (ok) props.onBoundary?.();
      }
      dragEndRef.current = null;
      setDraggingEnd(null);
      setDragScreen(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // The listener set is stable for the duration of one drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingEnd]);

  // World-space preview while dragging a handle.
  let previewLine: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (draggingEnd && dragScreen) {
    const fixedEnd = draggingEnd === 'from' ? to : from;
    const dragWorld = screenToWorld(camRef.current, dragScreen);
    previewLine = { x1: fixedEnd.x, y1: fixedEnd.y, x2: dragWorld.x, y2: dragWorld.y };
  }

  return (
    <svg
      data-vidi6="connector"
      data-selected={selected || undefined}
      role="img"
      aria-label="Connector"
      className="connector-object"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        overflow: 'visible',
        zIndex: connector.z,
        pointerEvents: 'none',
      }}
    >
      {/* Wide transparent hit stroke (selects the arrow). */}
      <line
        data-vidi6="connector-line"
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="transparent"
        strokeWidth={hitWidth}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onPointerDown={(e) => props.onPointerDown(e, connector.id)}
      />
      {/* Visible line (stops at the arrowhead base). */}
      <line
        x1={from.x}
        y1={from.y}
        x2={baseX}
        y2={baseY}
        stroke={ARROW_COLOR}
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
        style={{ pointerEvents: 'none' }}
      />
      <polygon
        data-vidi6="connector-arrowhead"
        points={arrowPoints}
        fill={ARROW_COLOR}
        style={{ pointerEvents: 'none' }}
      />
      {selected && (
        <>
          <circle
            data-vidi6="connector-handle"
            data-end="from"
            cx={from.x}
            cy={from.y}
            r={CONNECTOR_DOT_RADIUS_PX * 2 / zoom}
            fill="#FFFFFF"
            stroke={ARROW_COLOR}
            strokeWidth={1.5 / zoom}
            style={{ pointerEvents: 'all', cursor: 'grab' }}
            onPointerDown={startHandleDrag('from')}
          />
          <circle
            data-vidi6="connector-handle"
            data-end="to"
            cx={to.x}
            cy={to.y}
            r={CONNECTOR_DOT_RADIUS_PX * 2 / zoom}
            fill="#FFFFFF"
            stroke={ARROW_COLOR}
            strokeWidth={1.5 / zoom}
            style={{ pointerEvents: 'all', cursor: 'grab' }}
            onPointerDown={startHandleDrag('to')}
          />
        </>
      )}
      {previewLine && (
        <line
          data-vidi6="connector-preview"
          x1={previewLine.x1}
          y1={previewLine.y1}
          x2={previewLine.x2}
          y2={previewLine.y2}
          stroke={ARROW_COLOR}
          strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
          strokeDasharray="6 4"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  );
}
