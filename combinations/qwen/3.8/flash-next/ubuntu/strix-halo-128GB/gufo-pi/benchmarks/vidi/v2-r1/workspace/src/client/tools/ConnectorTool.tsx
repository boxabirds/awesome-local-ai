/**
 * ConnectorTool: hover dots on objects, drag to create arrows.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { Point, ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';
import { nearestSide, sideAnchor, type Side } from '../../shared/geometry/connector-geometry';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import type { Endpoint } from '../../shared/objects/connector';

export interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  onCreated(id: string): void;
  /** Creates the connector via the model. */
  createConnectorAt(from: Endpoint, to: Endpoint): string | null;
  /** Undo boundary. */
  undoBoundary(): void;
}

interface DragState {
  startPoint: Point;
  startObjectId: string | null;
  currentPoint: Point;
  targetObjectId: string | null;
  targetSide: Side | null;
}

interface HoverState {
  objectId: string;
  rect: Rect;
  dots: Array<{ side: Side; point: Point; highlighted: boolean }>;
}

export function ConnectorTool(props: ConnectorToolProps): JSX.Element | null {
  const { camera, snapshot, onCreated, createConnectorAt, undoBoundary } = props;

  const [hover, setHover] = useState<HoverState | null>(null);
  const [dragVisual, setDragVisual] = useState<DragState | null>(null);
  const pointerId = useRef<number | null>(null);
  // Mutable drag state — updated synchronously, not via React state.
  const drag = useRef<DragState | null>(null);

  // Refs to avoid stale closures in event listeners
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const createConnectorAtRef = useRef(createConnectorAt);
  createConnectorAtRef.current = createConnectorAt;
  const undoBoundaryRef = useRef(undoBoundary);
  undoBoundaryRef.current = undoBoundary;

  /** Find the object under a world point (simple bounds check). */
  const hitTest = useCallback((worldPoint: Point): ObjectSnapshot | null => {
    const snap = snapshotRef.current;
    for (let i = snap.length - 1; i >= 0; i--) {
      const obj = snap[i];
      if (obj.type === 'connector') continue;
      const bounds = objectBounds(obj);
      if (
        worldPoint.x >= bounds.x &&
        worldPoint.y >= bounds.y &&
        worldPoint.x <= bounds.x + bounds.width &&
        worldPoint.y <= bounds.y + bounds.height
      ) {
        return obj;
      }
    }
    return null;
  }, []);

  /** Get four side dot positions for a rect. */
  const getDots = useCallback((rect: Rect, highlightedSide: Side | null): Array<{ side: Side; point: Point; highlighted: boolean }> => {
    const sides: Side[] = ['top', 'right', 'bottom', 'left'];
    return sides.map((s) => ({
      side: s,
      point: sideAnchor(rect, s),
      highlighted: s === highlightedSide,
    }));
  }, []);

  const handlePointerDown = useCallback((event: PointerEvent) => {
    if (pointerId.current !== null) return;
    // Don't capture clicks on toolbar, controls, or other UI
    const target = event.target as HTMLElement;
    if (target.closest('[data-board-surface]') === null) return;
    pointerId.current = event.pointerId;
    const world = screenToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });
    const hit = hitTest(world);
    const ds: DragState = {
      startPoint: world,
      startObjectId: hit?.id ?? null,
      currentPoint: world,
      targetObjectId: null,
      targetSide: null,
    };
    drag.current = ds;
    setDragVisual(ds);
    event.preventDefault();
    event.stopPropagation();
  }, [hitTest]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const world = screenToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });

    if (pointerId.current === event.pointerId && drag.current) {
      const hit = hitTest(world);
      let targetObjectId: string | null = null;
      let targetSide: Side | null = null;

      if (hit && hit.id !== drag.current.startObjectId) {
        targetObjectId = hit.id;
        const bounds = objectBounds(hit);
        targetSide = nearestSide(bounds, drag.current.startPoint);
      }

      const updated: DragState = {
        ...drag.current,
        currentPoint: world,
        targetObjectId,
        targetSide,
      };
      drag.current = updated;
      setDragVisual(updated);
    } else {
      // Hover logic
      const hit = hitTest(world);
      if (hit) {
        const bounds = objectBounds(hit);
        setHover({
          objectId: hit.id,
          rect: bounds,
          dots: getDots(bounds, null),
        });
      } else {
        setHover(null);
      }
    }
  }, [hitTest, getDots]);

  const handlePointerUp = useCallback((event: PointerEvent) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    const currentDrag = drag.current;
    drag.current = null;
    setDragVisual(null);

    if (!currentDrag) return;

    const endWorld = screenToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });

    const length = Math.hypot(endWorld.x - currentDrag.startPoint.x, endWorld.y - currentDrag.startPoint.y);
    if (length < CONNECTOR_MIN_LENGTH_WORLD) return;

    const hit = hitTest(endWorld);
    const targetObjectId = hit?.id ?? null;

    if (targetObjectId && targetObjectId === currentDrag.startObjectId) return;

    const snap = snapshotRef.current;

    let from: Endpoint;
    if (currentDrag.startObjectId) {
      const startObj = snap.find((s) => s.id === currentDrag.startObjectId);
      const bounds = startObj ? objectBounds(startObj) : { x: currentDrag.startPoint.x, y: currentDrag.startPoint.y, width: 100, height: 100 };
      const side = nearestSide(bounds, endWorld);
      const anchor = sideAnchor(bounds, side);
      from = { kind: 'attached', objectId: currentDrag.startObjectId, fallback: anchor };
    } else {
      from = { kind: 'free', x: currentDrag.startPoint.x, y: currentDrag.startPoint.y };
    }

    let to: Endpoint;
    if (targetObjectId) {
      const targetObj = snap.find((s) => s.id === targetObjectId);
      const bounds = targetObj ? objectBounds(targetObj) : { x: endWorld.x, y: endWorld.y, width: 100, height: 100 };
      const side = nearestSide(bounds, currentDrag.startPoint);
      const anchor = sideAnchor(bounds, side);
      to = { kind: 'attached', objectId: targetObjectId, fallback: anchor };
    } else {
      to = { kind: 'free', x: endWorld.x, y: endWorld.y };
    }

    undoBoundaryRef.current();
    const id = createConnectorAtRef.current(from, to);
    undoBoundaryRef.current();
    if (id !== null) {
      onCreatedRef.current(id);
    }
  }, [hitTest]);

  const handlePointerCancel = useCallback((event: PointerEvent) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    drag.current = null;
    setDragVisual(null);
  }, []);

  useEffect(() => {
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointercancel', handlePointerCancel, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
      document.removeEventListener('pointercancel', handlePointerCancel, true);
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel]);

  // Render overlay
  const elements: JSX.Element[] = [];

  // Hover dots
  if (hover && !dragVisual) {
    hover.dots.forEach((dot) => {
      const screen = worldToScreen(camera, dot.point);
      const r = CONNECTOR_DOT_RADIUS_PX;
      elements.push(
        <circle
          key={`dot-${hover.objectId}-${dot.side}`}
          data-testid={`connector-dot-${dot.side}`}
          cx={screen.x}
          cy={screen.y}
          r={r}
          fill={dot.highlighted ? '#1E88E5' : '#fff'}
          stroke="#1E88E5"
          strokeWidth={1.5}
        />,
      );
    });
  }

  // Drag preview line
  if (dragVisual) {
    const startScreen = worldToScreen(camera, dragVisual.startPoint);
    let endScreen: Point;
    if (dragVisual.targetObjectId && dragVisual.targetSide) {
      const targetObj = snapshot.find((s) => s.id === dragVisual.targetObjectId);
      if (targetObj) {
        const bounds = objectBounds(targetObj);
        const anchor = sideAnchor(bounds, dragVisual.targetSide);
        endScreen = worldToScreen(camera, anchor);
      } else {
        endScreen = worldToScreen(camera, dragVisual.currentPoint);
      }
    } else {
      endScreen = worldToScreen(camera, dragVisual.currentPoint);
    }

    elements.push(
      <line
        key="drag-preview"
        data-testid="connector-preview"
        x1={startScreen.x}
        y1={startScreen.y}
        x2={endScreen.x}
        y2={endScreen.y}
        stroke="#1E88E5"
        strokeWidth={2}
        strokeDasharray="6 3"
      />,
    );

    if (dragVisual.targetObjectId && dragVisual.targetSide) {
      const targetObj = snapshot.find((s) => s.id === dragVisual.targetObjectId);
      if (targetObj) {
        const bounds = objectBounds(targetObj);
        const sides: Side[] = ['top', 'right', 'bottom', 'left'];
        sides.forEach((s) => {
          const pt = sideAnchor(bounds, s);
          const screen = worldToScreen(camera, pt);
          elements.push(
            <circle
              key={`highlight-${s}`}
              data-testid={`connector-highlight-${s}`}
              cx={screen.x}
              cy={screen.y}
              r={CONNECTOR_DOT_RADIUS_PX}
              fill={s === dragVisual!.targetSide ? '#1E88E5' : '#fff'}
              stroke="#1E88E5"
              strokeWidth={1.5}
            />,
          );
        });
      }
    }
  }

  if (elements.length === 0) return null;

  return (
    <svg
      data-testid="connector-tool-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      {elements}
    </svg>
  );
}
