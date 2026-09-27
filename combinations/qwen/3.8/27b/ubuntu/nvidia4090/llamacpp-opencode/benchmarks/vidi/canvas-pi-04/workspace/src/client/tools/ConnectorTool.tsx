// Story 10: the Connector tool (anchor: connector.create_attached,
// connector.create_free, connector.attach).
//
// While active (rendered by App in the screen-space board overlay):
//  - attach dots render at the four side anchors of every rectangular object
//    (sticky/text/shape); hovering near an anchor highlights it;
//  - a press starts the drag from that anchor (attached endpoint) or, away
//    from any object, from a free point at the press;
//  - a dashed preview line follows the pointer; the nearest OTHER object's
//    anchor within the snap radius is highlighted as the release target;
//  - a release on an anchor (or within the snap radius of one) creates the
//    arrow with both ends attached (connector.create_attached); a release in
//    free space creates an attached→free (or free→free) arrow
//    (connector.create_free);
//  - an arrow shorter than CONNECTOR_MIN_LENGTH_WORLD on release creates
//    nothing (connector.create_free).
//
// The component only reports the gesture; App runs the model call.

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  CONNECTOR_SNAP_RADIUS_PX,
} from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Endpoint } from '../../shared/objects/connector';
import type { Point } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';

interface Dot {
  objectId: string;
  anchor: Point;
  /** Screen position. */
  sx: number;
  sy: number;
}

interface HoverState {
  dot: Dot | null;
  pointer: Point;
  /** Set while a drag is in flight. */
  dragging: boolean;
  /** The drag's origin endpoint (fixed). */
  from: Endpoint | null;
  /** The live release target, if the pointer is near another anchor. */
  target: Dot | null;
}

/** The four side anchors of every rectangular object in screen space. */
function dotsFor(snapshot: readonly ObjectSnapshot[], camera: Camera): Dot[] {
  const out: Dot[] = [];
  for (const o of snapshot) {
    if (o.type === 'connector') continue;
    const b = objectBounds(o);
    const anchors: Point[] = [
      { x: b.x + b.width / 2, y: b.y },
      { x: b.x + b.width, y: b.y + b.height / 2 },
      { x: b.x + b.width / 2, y: b.y + b.height },
      { x: b.x, y: b.y + b.height / 2 },
    ];
    for (const anchor of anchors) {
      const s = worldToScreen(camera, anchor);
      out.push({ objectId: o.id, anchor, sx: s.x, sy: s.y });
    }
  }
  return out;
}

/** The dot nearest a screen point, or null when none is within `radius`. */
function nearestDot(
  dots: Dot[],
  sx: number,
  sy: number,
  radius: number,
  exclude: ReadonlySet<string> = new Set(),
): Dot | null {
  let best: Dot | null = null;
  let bestDist = radius;
  for (const d of dots) {
    if (exclude.has(d.objectId)) continue;
    const dist = Math.hypot(d.sx - sx, d.sy - sy);
    if (dist <= bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

export function ConnectorTool(props: {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  /** Report a finished drag as its two endpoints (the model validates them). */
  onCreateConnector(from: Endpoint, to: Endpoint): void;
}): JSX.Element | null {
  const [state, setState] = useState<HoverState | null>(null);
  const cameraRef = useRef(props.camera);
  cameraRef.current = props.camera;
  const snapshotRef = useRef(props.snapshot);
  snapshotRef.current = props.snapshot;
  const callbackRef = useRef(props.onCreateConnector);
  callbackRef.current = props.onCreateConnector;

  useEffect(() => {
    const localScreen = (clientX: number, clientY: number): { sx: number; sy: number } | null => {
      const root = document.querySelector('[data-testid="board-viewport"]');
      if (root === null) return null;
      const rect = root.getBoundingClientRect();
      // jsdom reports a zero-sized rect: skip the bounds check there.
      const inside =
        rect.width === 0 && rect.height === 0
          ? true
          : clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      if (!inside) return null;
      return { sx: clientX - rect.left, sy: clientY - rect.top };
    };

    let dragFrom: Endpoint | null = null;
    let pointerId: number | null = null;

    const update = (clientX: number, clientY: number, dragging: boolean): void => {
      const s = localScreen(clientX, clientY);
      if (s === null) {
        if (dragFrom !== null) setState(null);
        return;
      }
      const cam = cameraRef.current;
      const dots = dotsFor(snapshotRef.current, cam);
      const pointer = screenToWorld(cam, { x: s.sx, y: s.sy });
      if (!dragging) {
        setState({ dot: nearestDot(dots, s.sx, s.sy, CONNECTOR_SNAP_RADIUS_PX), pointer, dragging: false, from: null, target: null });
        return;
      }
      const exclude = new Set<string>();
      if (dragFrom !== null && dragFrom.kind === 'attached') exclude.add(dragFrom.objectId);
      const target = nearestDot(dots, s.sx, s.sy, CONNECTOR_SNAP_RADIUS_PX, exclude);
      setState({ dot: null, pointer, dragging: true, from: dragFrom, target });
    };

    const onMove = (e: PointerEvent): void => {
      update(e.clientX, e.clientY, pointerId !== null);
    };
    const onDown = (e: PointerEvent): void => {
      if (pointerId !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const root = document.querySelector('[data-testid="board-viewport"]');
      if (root === null || !root.contains(e.target as Node)) return;
      const s = localScreen(e.clientX, e.clientY);
      if (s === null) return;
      const cam = cameraRef.current;
      const dots = dotsFor(snapshotRef.current, cam);
      const dot = nearestDot(dots, s.sx, s.sy, CONNECTOR_SNAP_RADIUS_PX);
      const pointer = screenToWorld(cam, { x: s.sx, y: s.sy });
      dragFrom =
        dot !== null
          ? { kind: 'attached', objectId: dot.objectId, fallback: dot.anchor }
          : { kind: 'free', x: pointer.x, y: pointer.y };
      pointerId = e.pointerId;
      update(e.clientX, e.clientY, true);
    };
    const finish = (e: PointerEvent): void => {
      if (pointerId !== e.pointerId || dragFrom === null) return;
      pointerId = null;
      const s = localScreen(e.clientX, e.clientY);
      const cam = cameraRef.current;
      if (s !== null) {
        const dots = dotsFor(snapshotRef.current, cam);
        const exclude = new Set<string>();
        if (dragFrom.kind === 'attached') exclude.add(dragFrom.objectId);
        const target = nearestDot(dots, s.sx, s.sy, CONNECTOR_SNAP_RADIUS_PX, exclude);
        const resolvedTo = target !== null ? target.anchor : screenToWorld(cam, { x: s.sx, y: s.sy });
        const to: Endpoint =
          target !== null
            ? { kind: 'attached', objectId: target.objectId, fallback: target.anchor }
            : { kind: 'free', x: resolvedTo.x, y: resolvedTo.y };
        // Minimum length on the RESOLVED endpoints (connector.create_free).
        const fromPoint =
          dragFrom.kind === 'attached' ? dragFrom.fallback : { x: dragFrom.x, y: dragFrom.y };
        if (Math.hypot(resolvedTo.x - fromPoint.x, resolvedTo.y - fromPoint.y) >= CONNECTOR_MIN_LENGTH_WORLD) {
          callbackRef.current(dragFrom, to);
        }
      }
      dragFrom = null;
      setState(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, []);

  const dots = dotsFor(props.snapshot, props.camera);
  if (state === null) {
    // No pointer over the board yet: render nothing (the tool is idle).
    return null;
  }

  const fromScreen =
    state.from !== null
      ? worldToScreen(
          props.camera,
          state.from.kind === 'attached' ? state.from.fallback : { x: state.from.x, y: state.from.y },
        )
      : null;
  const pointerScreen = worldToScreen(props.camera, state.pointer);

  return (
    <div className="connector-tool" data-testid="connector-tool">
      {/* Attach dots: one per side anchor of each rectangular object. */}
      {dots.map((d) => {
        const isHover = state.dot !== null && state.dot.objectId === d.objectId && state.dot.anchor.x === d.anchor.x && state.dot.anchor.y === d.anchor.y;
        const isTarget = state.target !== null && state.target.objectId === d.objectId && state.target.anchor.x === d.anchor.x && state.target.anchor.y === d.anchor.y;
        const r = isHover || isTarget ? CONNECTOR_DOT_RADIUS_PX + 2 : CONNECTOR_DOT_RADIUS_PX;
        return (
          <div
            key={`${d.objectId}-${d.anchor.x}-${d.anchor.y}`}
            className={`connector-tool__dot${isHover || isTarget ? ' is-active' : ''}`}
            data-testid="connector-dot"
            data-active={isHover || isTarget ? 'true' : undefined}
            style={{ left: d.sx, top: d.sy, width: r * 2, height: r * 2 }}
          />
        );
      })}
      {/* Preview line while dragging. */}
      {state.dragging && fromScreen !== null && (
        <svg className="connector-tool__preview" width="100%" height="100%">
          <line
            data-testid="connector-preview"
            x1={fromScreen.x}
            y1={fromScreen.y}
            x2={pointerScreen.x}
            y2={pointerScreen.y}
            stroke="var(--accent, #1E88E5)"
            strokeWidth="2"
            strokeDasharray="6 4"
          />
        </svg>
      )}
    </div>
  );
}
