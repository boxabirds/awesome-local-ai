import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { CONNECTOR_COLOR, CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD, CONNECTOR_STROKE_WIDTH_WORLD } from '../../shared/config';
import { nearestSide, SIDES, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import { NO_UNDO, type UndoController } from '../board/undo';
import { localIdentityId } from '../identity';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { boundsHitTest, getObjectType } from '../objects/registry';
import { ToolLayer } from './ToolLayer';

/** The topmost board object under a world point; arrows themselves are not connection targets. */
export function objectAt(snapshot: readonly ObjectSnapshot[], p: Point): ObjectSnapshot | undefined {
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const o = snapshot[i];
    if (o.type === 'connector') continue;
    const hit = getObjectType(o.type)?.hitTest ?? boundsHitTest;
    if (hit(o, p)) return o;
  }
  return undefined;
}

interface Drag {
  pointerId: number;
  start: Point; // world
  startObject: ObjectSnapshot | undefined;
  cur: Point; // world
}

const DOT_COLOR = '#1e88e5';

/** Connector tool: hover shows the four side dots, a drag shows a preview and highlights the target dot. */
export function ConnectorTool(props: {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  undo?: UndoController;
  onCreated(id: string): void;
}) {
  const { camera, doc, onCreated } = props;
  const undo = props.undo ?? NO_UNDO;
  const latest = useRef(props);
  latest.current = props;
  const [hover, setHover] = useState<Point | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const set = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const world = (e: ReactPointerEvent<HTMLDivElement>) => screenToWorld(camera, { x: e.clientX, y: e.clientY });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = world(e);
    set({ pointerId: e.pointerId, start: p, startObject: objectAt(latest.current.snapshot, p), cur: p });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = world(e);
    const d = dragRef.current;
    if (d && d.pointerId === e.pointerId) set({ ...d, cur: p });
    else if (!d) setHover(p);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    set(null);
    const end = world(e);
    if (Math.hypot(end.x - d.start.x, end.y - d.start.y) < CONNECTOR_MIN_LENGTH_WORLD) return;
    const target = objectAt(latest.current.snapshot, end);
    if (target && d.startObject && target.id === d.startObject.id) return;
    const endpoint = (o: ObjectSnapshot | undefined, at: Point, other: Point): Endpoint => {
      if (!o) return { kind: 'free', x: at.x, y: at.y };
      const r = objectBounds(o);
      return { kind: 'attached', objectId: o.id, fallback: sideAnchor(r, nearestSide(r, other)) };
    };
    const from = endpoint(d.startObject, d.start, end);
    const to = endpoint(target, end, d.start);
    undo.boundary();
    const id = createConnector(doc, from, to, localIdentityId());
    undo.boundary();
    if (id) onCreated(id);
  };

  // While dragging, the dots belong to the object under the pointer; otherwise to the hovered object.
  const probe = drag ? drag.cur : hover;
  const dotObject = probe ? objectAt(props.snapshot, probe) : undefined;
  const dotSide: Side | null = drag && dotObject && dotObject.id !== drag.startObject?.id ? nearestSide(objectBounds(dotObject), drag.start) : null;
  const toScreen = (p: Point) => worldToScreen(camera, p);

  let previewFrom: Point | null = null;
  let previewTo: Point | null = null;
  if (drag) {
    const startR = drag.startObject ? objectBounds(drag.startObject) : null;
    previewFrom = startR ? sideAnchor(startR, nearestSide(startR, drag.cur)) : drag.start;
    previewTo = dotObject && dotSide ? sideAnchor(objectBounds(dotObject), dotSide) : drag.cur;
  }

  return (
    <ToolLayer
      testId="connector-tool-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => set(null)}
      onPointerLeave={() => setHover(null)}
    >
      {dotObject &&
        SIDES.map((side) => {
          const a = toScreen(sideAnchor(objectBounds(dotObject), side));
          const highlighted = side === dotSide;
          const r = highlighted ? CONNECTOR_DOT_RADIUS_PX + 2 : CONNECTOR_DOT_RADIUS_PX;
          return (
            <div
              key={side}
              data-testid={`connection-dot-${side}`}
              data-highlighted={highlighted ? 'true' : 'false'}
              style={{
                position: 'fixed',
                left: a.x - r,
                top: a.y - r,
                width: r * 2,
                height: r * 2,
                borderRadius: '50%',
                boxSizing: 'border-box',
                background: highlighted ? DOT_COLOR : '#fff',
                border: `2px solid ${DOT_COLOR}`,
                pointerEvents: 'none',
              }}
            />
          );
        })}
      {previewFrom && previewTo && (
        <svg data-testid="connector-preview" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <line
            x1={toScreen(previewFrom).x}
            y1={toScreen(previewFrom).y}
            x2={toScreen(previewTo).x}
            y2={toScreen(previewTo).y}
            stroke={CONNECTOR_COLOR}
            strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD * camera.zoom}
            strokeDasharray="6 4"
          />
        </svg>
      )}
    </ToolLayer>
  );
}

