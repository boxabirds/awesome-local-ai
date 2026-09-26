/**
 * Connector tool (story 10).
 *
 * Shows hover dots on the object under the pointer, handles drag-to-connect,
 * and highlights the nearest-side dot on the target object during a drag.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import { nearestSide, sideAnchor } from '../../shared/geometry/connector-geometry';
import type { Rect } from '../../shared/geometry';

export interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  doc: import('yjs').Doc;
  onCreated(id: string): void;
}

interface DragState {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startId: string | null;
  targetId: string | null;
}

export function ConnectorTool(props: ConnectorToolProps): JSX.Element | null {
  const { camera, snapshot, doc } = props;
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // Build rects map for hit testing.
  const rectsMap = new Map<string, Rect>();
  for (const obj of snapshot) {
    if (obj.type === 'connector') continue;
    rectsMap.set(obj.id, objectBounds(obj));
  }

  useEffect(() => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement | null;
    if (!el) return;

    const findObjectAt = (screenX: number, screenY: number): string | null => {
      const cam = propsRef.current.camera;
      const world = screenToWorld(cam, { x: screenX, y: screenY });
      let best: string | null = null;
      let bestZ = -1;
      for (const obj of propsRef.current.snapshot) {
        if (obj.type === 'connector') continue;
        const r = objectBounds(obj);
        if (world.x >= r.x && world.x <= r.x + r.width && world.y >= r.y && world.y <= r.y + r.height) {
          if (obj.z > bestZ) {
            bestZ = obj.z;
            best = obj.id;
          }
        }
      }
      return best;
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (dragRef.current) {
        const rect = el.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const targetId = findObjectAt(x, y);
        const state: DragState = {
          ...dragRef.current,
          endX: x,
          endY: y,
          targetId: targetId && targetId !== dragRef.current.startId ? targetId : null,
        };
        dragRef.current = state;
        setDragState(state);
        return;
      }
      // Hover: show dots for object under pointer.
      const rect = el.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const objId = findObjectAt(x, y);
      setHoverId(objId);
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || event.pointerType !== 'mouse') return;
      event.stopPropagation();
      event.preventDefault();

      const rect = el.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const objId = findObjectAt(x, y);

      const state: DragState = {
        startX: x, startY: y,
        endX: x, endY: y,
        startId: objId,
        targetId: null,
      };
      dragRef.current = state;
      setDragState(state);
    };

    const onPointerUp = (): void => {
      const state = dragRef.current;
      dragRef.current = null;
      setDragState(null);
      setHoverId(null);

      if (!state) return;

      const cam = propsRef.current.camera;
      const startWorld = screenToWorld(cam, { x: state.startX, y: state.startY });
      const endWorld = screenToWorld(cam, { x: state.endX, y: state.endY });

      const dx = endWorld.x - startWorld.x;
      const dy = endWorld.y - startWorld.y;
      const length = Math.sqrt(dx * dx + dy * dy);

      // Too short or same object: reject.
      if (length < CONNECTOR_MIN_LENGTH_WORLD) return;
      if (state.startId && state.startId === state.targetId) return;

      // Build endpoints.
      const from: Endpoint = state.startId
        ? { kind: 'attached', objectId: state.startId, fallback: startWorld }
        : { kind: 'free', x: startWorld.x, y: startWorld.y };

      const to: Endpoint = state.targetId
        ? { kind: 'attached', objectId: state.targetId, fallback: endWorld }
        : { kind: 'free', x: endWorld.x, y: endWorld.y };

      const id = createConnector(propsRef.current.doc, from, to, 'local');
      if (id) {
        propsRef.current.onCreated(id);
      }
    };

    el.addEventListener('pointerdown', onPointerDown, true);
    el.addEventListener('pointermove', onPointerMove, true);
    el.addEventListener('pointerup', onPointerUp, true);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('pointermove', onPointerMove, true);
      el.removeEventListener('pointerup', onPointerUp, true);
    };
  }, [doc]);

  // Render dots and drag preview.
  const elements: JSX.Element[] = [];

  // Hover dots.
  if (hoverId && !dragState) {
    const r = rectsMap.get(hoverId);
    if (r) {
      const zoom = camera.zoom;
      const rPx = CONNECTOR_DOT_RADIUS_PX / zoom;
      const sides = [
        sideAnchor(r, 'top'),
        sideAnchor(r, 'right'),
        sideAnchor(r, 'bottom'),
        sideAnchor(r, 'left'),
      ];
      sides.forEach((pt, i) => {
        elements.push(
          <circle
            key={`dot-${hoverId}-${i}`}
            cx={pt.x}
            cy={pt.y}
            r={rPx}
            fill="#4FC3F7"
            opacity={0.8}
          />,
        );
      });
    }
  }

  // Drag preview line and target dot highlight.
  if (dragState) {
    const startWorld = screenToWorld(camera, { x: dragState.startX, y: dragState.startY });
    const endWorld = screenToWorld(camera, { x: dragState.endX, y: dragState.endY });

    // Preview line.
    elements.push(
      <line
        key="preview-line"
        x1={startWorld.x}
        y1={startWorld.y}
        x2={endWorld.x}
        y2={endWorld.y}
        stroke="#999"
        strokeWidth={2 / camera.zoom}
        strokeDasharray={`${4 / camera.zoom} ${4 / camera.zoom}`}
      />,
    );

    // Highlight target dot.
    if (dragState.targetId) {
      const targetRect = rectsMap.get(dragState.targetId);
      if (targetRect) {
        const zoom = camera.zoom;
        const rPx = CONNECTOR_DOT_RADIUS_PX / zoom;
        const side = nearestSide(targetRect, startWorld);
        const anchor = sideAnchor(targetRect, side);
        elements.push(
          <circle
            key="target-dot"
            cx={anchor.x}
            cy={anchor.y}
            r={rPx * 1.5}
            fill="#FF5722"
            opacity={0.9}
          />,
        );
      }
    }
  }

  if (elements.length === 0) return null;

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      data-testid="connector-tool-svg"
    >
      {elements}
    </svg>
  );
}
