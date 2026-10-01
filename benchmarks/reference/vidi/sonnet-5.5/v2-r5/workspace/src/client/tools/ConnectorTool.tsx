import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { centreOf, nearestSide, type Side } from '../../shared/geometry/connector-geometry';
import { createConnector } from '../../shared/objects/connector';
import type { UndoController } from '../board/undo';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { endpointFor } from '../objects/ConnectorObject';
import { ConnectionDots } from './ConnectionDots';
import { attachableRects, topRectAt } from './hit';
import { useForwardWheel } from './useForwardWheel';

const PRIMARY_BUTTON = 0;

interface Gesture { startPoint: Point; startId: string | undefined; current: Point; pointerId: number }

/**
 * Full-board layer while the Connector tool is active: hover shows connection dots, a drag draws a preview and a
 * release creates the arrow (attached to whatever is under each end). Escape is handled by the board.
 */
export function ConnectorTool(props: {
  camera: Camera; snapshot: readonly ObjectSnapshot[]; doc: Y.Doc; by: string; undo?: UndoController;
  onCreated(id: string): void;
}) {
  const { camera, snapshot, doc, by, undo } = props;
  const layer = useRef<HTMLDivElement>(null);
  useForwardWheel(layer);
  const rects = useMemo(() => attachableRects(snapshot), [snapshot]);
  const [hover, setHover] = useState<Point | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const set = (g: Gesture | null) => { gestureRef.current = g; setGesture(g); };

  const worldOf = (e: { clientX: number; clientY: number }): Point => {
    const r = layer.current?.getBoundingClientRect();
    return screenToWorld(camera, { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = worldOf(e);
    set({ startPoint: p, startId: topRectAt(rects, p), current: p, pointerId: e.pointerId });
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = worldOf(e);
    setHover(p);
    const g = gestureRef.current;
    if (g && g.pointerId === e.pointerId) set({ ...g, current: p });
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    set(null);
    const end = worldOf(e);
    if (Math.hypot(end.x - g.startPoint.x, end.y - g.startPoint.y) < CONNECTOR_MIN_LENGTH_WORLD) return;
    const targetId = topRectAt(rects, end);
    if (targetId !== undefined && targetId === g.startId) return;
    const startRect = g.startId ? rects.get(g.startId) : undefined;
    const targetRect = targetId ? rects.get(targetId) : undefined;
    const startAim = startRect ? centreOf(startRect) : g.startPoint;
    const endAim = targetRect ? centreOf(targetRect) : end;
    undo?.boundary();
    const id = createConnector(
      doc,
      endpointFor(rects, g.startId, g.startPoint, endAim),
      endpointFor(rects, targetId, end, startAim),
      by,
    );
    undo?.boundary();
    if (id) props.onCreated(id);
  };

  const pointer = gesture?.current ?? hover;
  const hoverId = pointer ? topRectAt(rects, pointer) : undefined;
  let highlight: Side | null = null;
  if (gesture && hoverId && hoverId !== gesture.startId) {
    const startRect = gesture.startId ? rects.get(gesture.startId) : undefined;
    highlight = nearestSide(rects.get(hoverId)!, startRect ? centreOf(startRect) : gesture.startPoint);
  }
  const from = gesture ? worldToScreen(camera, gesture.startPoint) : null;
  const to = gesture ? worldToScreen(camera, gesture.current) : null;

  return (
    <div
      ref={layer}
      className="tool-layer connector-tool-layer"
      data-testid="connector-tool-layer"
      style={{ cursor: 'crosshair' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => { if (!gestureRef.current) setHover(null); }}
      onPointerCancel={() => set(null)}
    >
      {hoverId && <ConnectionDots rect={rects.get(hoverId)!} camera={camera} highlight={highlight} />}
      {from && to && (
        <svg className="connector-preview" data-testid="connector-preview" width="100%" height="100%">
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" />
        </svg>
      )}
    </div>
  );
}
