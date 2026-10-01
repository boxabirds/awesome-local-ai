import { useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import {
  endReference, nearestSide, resolveEndpoints, SIDES, sideAnchor, type Endpoint, type Side,
} from '../../shared/geometry/connector-geometry';
import { createConnector } from '../../shared/objects/connector';
import { localIdentityId } from '../board/identity';
import { useUndoController } from '../board/useUndo';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { objectAt } from '../objects/ConnectorObject';
import { localPoint, useToolGesture } from './toolLayer';

interface Drag { startId: string | null; startPoint: Point; cur: Point }

/** Hover over an object to see its four connection dots; drag from one object (or empty space) to another to draw an arrow. */
export function ConnectorTool(props: {
  camera: Camera; snapshot: readonly ObjectSnapshot[]; doc: Y.Doc; onCreated(id: string): void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const undo = useUndoController();
  const rects = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const o of props.snapshot) if (o.type !== 'connector') m.set(o.id, objectBounds(o));
    return m;
  }, [props.snapshot]);
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const latest = useRef({ ...props, undo, rects });
  latest.current = { ...props, undo, rects };

  const world = (viewport: HTMLElement, e: PointerEvent): Point => screenToWorld(latest.current.camera, localPoint(viewport, e));

  const endpointFor = (id: string | null, p: Point, toward: Point): Endpoint => {
    const r = id ? latest.current.rects.get(id) : undefined;
    if (!id || !r) return { kind: 'free', x: p.x, y: p.y };
    return { kind: 'attached', objectId: id, fallback: sideAnchor(r, nearestSide(r, toward)) };
  };

  useToolGesture(layer, {
    onDown: (e, viewport) => {
      const p = world(viewport, e);
      setDrag({ startId: objectAt(latest.current.rects, p), startPoint: p, cur: p });
      return true;
    },
    onMove: (e, viewport) => {
      const d = dragRef.current;
      if (d) setDrag({ ...d, cur: world(viewport, e) });
    },
    onUp: (e, viewport) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const { rects: rs, doc, onCreated, undo: u } = latest.current;
      const cur = world(viewport, e);
      const targetId = objectAt(rs, cur);
      if (Math.hypot(cur.x - d.startPoint.x, cur.y - d.startPoint.y) < CONNECTOR_MIN_LENGTH_WORLD) return;
      if (targetId !== null && targetId === d.startId) return;
      const startRect = d.startId ? rs.get(d.startId) : undefined;
      const targetRect = targetId ? rs.get(targetId) : undefined;
      const from = endpointFor(d.startId, d.startPoint, targetRect ? { x: targetRect.x + targetRect.width / 2, y: targetRect.y + targetRect.height / 2 } : cur);
      const to = endpointFor(targetId, cur, startRect ? { x: startRect.x + startRect.width / 2, y: startRect.y + startRect.height / 2 } : d.startPoint);
      u?.boundary();
      const id = createConnector(doc, from, to, localIdentityId());
      u?.boundary();
      if (id) onCreated(id);
    },
    onCancel: () => setDrag(null),
    onHover: (e, viewport) => setHover(objectAt(latest.current.rects, world(viewport, e))),
    onLeave: () => setHover(null),
  });

  const { camera } = props;
  // While dragging, the object under the pointer shows its dots and the side the arrow will use is highlighted.
  const targetId = drag ? objectAt(rects, drag.cur) : null;
  const dotsFor = drag ? (targetId !== drag.startId ? targetId : null) : hover;
  const dotRect = dotsFor ? rects.get(dotsFor) : undefined;
  let highlight: Side | null = null;
  let preview: { from: Point; to: Point } | null = null;
  if (drag) {
    const startEnd = endpointFor(drag.startId, drag.startPoint, drag.cur);
    const toEnd = endpointFor(dotsFor, drag.cur, endReference(startEnd, rects));
    if (dotRect) highlight = nearestSide(dotRect, endReference(startEnd, rects));
    preview = resolveEndpoints({ from: startEnd, to: toEnd }, rects);
  }
  const toScreen = (p: Point) => worldToScreen(camera, p);

  return (
    <div ref={layer} className="tool-layer" data-testid="connector-tool">
      {preview && (
        <svg className="connector-preview" data-testid="connector-preview" aria-hidden="true">
          <line
            x1={toScreen(preview.from).x} y1={toScreen(preview.from).y}
            x2={toScreen(preview.to).x} y2={toScreen(preview.to).y}
          />
        </svg>
      )}
      {dotsFor && dotRect && SIDES.map((side) => {
        const p = toScreen(sideAnchor(dotRect, side));
        return (
          <span
            key={side}
            className="connection-dot"
            data-testid="connection-dot"
            data-side={side}
            data-object-id={dotsFor}
            data-highlight={highlight === side ? 'true' : 'false'}
            style={{
              left: p.x - CONNECTOR_DOT_RADIUS_PX, top: p.y - CONNECTOR_DOT_RADIUS_PX,
              width: CONNECTOR_DOT_RADIUS_PX * 2, height: CONNECTOR_DOT_RADIUS_PX * 2,
            }}
          />
        );
      })}
    </div>
  );
}
