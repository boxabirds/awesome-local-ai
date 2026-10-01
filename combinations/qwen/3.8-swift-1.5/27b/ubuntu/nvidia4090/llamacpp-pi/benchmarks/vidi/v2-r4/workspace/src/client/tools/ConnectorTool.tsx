import { useRef, useEffect, useReducer, type JSX } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import { sideAnchor, nearestSide } from '../../shared/geometry/connector-geometry';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import type { Rect, Point } from '../../shared/geometry';
import type * as Y from 'yjs';

export interface ConnectorToolProps {
  camera: Camera;
  doc: Y.Doc;
  snapshot: readonly ObjectSnapshot[];
  createdBy: string;
  onCreated(id: string): void;
  onGestureEnd(): void;
}

/**
 * Connector tool: hover shows connection dots, drag from object to object
 * or empty space to create arrows.
 */
export function ConnectorTool(props: ConnectorToolProps): JSX.Element {
  const { camera, doc, snapshot, createdBy, onCreated, onGestureEnd } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ screen: Point; world: Point; objectId: string | null } | null>(null);
  const dragCurrentRef = useRef<Point | null>(null);
  const hoverObjectRef = useRef<string | null>(null);
  const targetObjectRef = useRef<string | null>(null);
  const targetSideRef = useRef<'top' | 'right' | 'bottom' | 'left' | null>(null);
  const [, forceRender] = useReducer((c: number) => c + 1, 0);

  // Build rects map from snapshot
  const rects = new Map<string, Rect>();
  for (const obj of snapshot) {
    const bounds = objectBounds(obj);
    rects.set(obj.id, bounds);
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const hitTest = (worldPt: Point): string | null => {
      // Test in reverse z-order (topmost first)
      const sorted = [...snapshot].sort((a, b) => b.z - a.z);
      for (const obj of sorted) {
        const bounds = objectBounds(obj);
        if (
          worldPt.x >= bounds.x &&
          worldPt.x <= bounds.x + bounds.width &&
          worldPt.y >= bounds.y &&
          worldPt.y <= bounds.y + bounds.height
        ) {
          return obj.id;
        }
      }
      return null;
    };

    const pd = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-testid="toolbar"]')) return;
      if (target.closest('[data-testid="selection-bar"]')) return;
      if (target.closest('[data-testid="shape-toolbar"]')) return;

      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const rect = el.getBoundingClientRect();
      const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const worldPt = screenToWorld(camera, screenPt);
      const objectId = hitTest(worldPt);

      dragStartRef.current = { screen: screenPt, world: worldPt, objectId };
      dragCurrentRef.current = screenPt;
      targetObjectRef.current = null;
      targetSideRef.current = null;
      forceRender();
    };

    const pm = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      // Update hover
      const worldPt = screenToWorld(camera, screenPt);
      const hoverId = hitTest(worldPt);
      if (hoverId !== hoverObjectRef.current) {
        hoverObjectRef.current = hoverId;
        forceRender();
      }

      if (dragStartRef.current) {
        dragCurrentRef.current = screenPt;

        // Find target and side
        if (hoverId && hoverId !== dragStartRef.current.objectId) {
          targetObjectRef.current = hoverId;
          const targetRect = rects.get(hoverId);
          if (targetRect) {
            targetSideRef.current = nearestSide(targetRect, dragStartRef.current.world);
          }
        } else {
          targetObjectRef.current = null;
          targetSideRef.current = null;
        }
        forceRender();
      }
    };

    const pu = (e: PointerEvent) => {
      if (!dragStartRef.current) return;
      try { el.releasePointerCapture(e.pointerId); } catch {}

      const rect = el.getBoundingClientRect();
      const endScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const endWorld = screenToWorld(camera, endScreen);
      const startWorld = dragStartRef.current.world;
      const startObjectId = dragStartRef.current.objectId;

      // Find end target
      const endObjectId = hitTest(endWorld);

      // Check minimum length
      const dx = endWorld.x - startWorld.x;
      const dy = endWorld.y - startWorld.y;
      const len = Math.sqrt(dx * dx + dy * dy);

      // Check if same object
      const sameObject = startObjectId !== null && endObjectId === startObjectId;

      if (!sameObject && len >= CONNECTOR_MIN_LENGTH_WORLD) {
        // Build endpoints
        let from: Endpoint;
        let to: Endpoint;

        if (startObjectId) {
          const startRect = rects.get(startObjectId)!;
          const endPt = endObjectId
            ? (() => {
                const er = rects.get(endObjectId)!;
                return { x: er.x + er.width / 2, y: er.y + er.height / 2 };
              })()
            : endWorld;
          const side = nearestSide(startRect, endPt);
          from = { kind: 'attached', objectId: startObjectId, fallback: sideAnchor(startRect, side) };
        } else {
          from = { kind: 'free', x: startWorld.x, y: startWorld.y };
        }

        if (endObjectId) {
          const endRect = rects.get(endObjectId)!;
          const startPt = startObjectId
            ? (() => {
                const sr = rects.get(startObjectId)!;
                return { x: sr.x + sr.width / 2, y: sr.y + sr.height / 2 };
              })()
            : startWorld;
          const side = nearestSide(endRect, startPt);
          to = { kind: 'attached', objectId: endObjectId, fallback: sideAnchor(endRect, side) };
        } else {
          to = { kind: 'free', x: endWorld.x, y: endWorld.y };
        }

        const id = createConnector(doc, from, to, createdBy);
        if (id) {
          onGestureEnd();
          onCreated(id);
        }
      }

      dragStartRef.current = null;
      dragCurrentRef.current = null;
      targetObjectRef.current = null;
      targetSideRef.current = null;
      forceRender();
    };

    const pc = () => {
      dragStartRef.current = null;
      dragCurrentRef.current = null;
      targetObjectRef.current = null;
      targetSideRef.current = null;
      forceRender();
    };

    el.addEventListener('pointerdown', pd, { capture: true });
    el.addEventListener('pointermove', pm);
    el.addEventListener('pointerup', pu);
    el.addEventListener('pointercancel', pc);
    return () => {
      el.removeEventListener('pointerdown', pd, { capture: true });
      el.removeEventListener('pointermove', pm);
      el.removeEventListener('pointerup', pu);
      el.removeEventListener('pointercancel', pc);
    };
  }, [camera, doc, snapshot, rects, createdBy, onCreated, onGestureEnd]);

  // Render dots and preview line
  const hoverId = hoverObjectRef.current;
  const dragStart = dragStartRef.current;
  const dragCurrent = dragCurrentRef.current;
  const targetId = targetObjectRef.current;
  const targetSide = targetSideRef.current;

  const dotR = CONNECTOR_DOT_RADIUS_PX / camera.zoom;

  return (
    <div
      ref={containerRef}
      data-testid="connector-tool-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 50,
        cursor: 'crosshair',
      }}
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        {/* Hover dots */}
        {hoverId && !dragStart && (() => {
          const r = rects.get(hoverId);
          if (!r) return null;
          const sides: ('top' | 'right' | 'bottom' | 'left')[] = ['top', 'right', 'bottom', 'left'];
          return sides.map((s) => {
            const p = sideAnchor(r, s);
            return (
              <circle
                key={s}
                cx={p.x}
                cy={p.y}
                r={dotR}
                fill="#2196F3"
                opacity={0.7}
                data-testid={`connector-dot-${s}`}
              />
            );
          });
        })()}

        {/* Drag preview line */}
        {dragStart && dragCurrent && (() => {
          const startWorld = dragStart.world;
          const endWorld = screenToWorld(camera, dragCurrent);

          // If target is highlighted, use the side anchor
          let endPt = endWorld;
          if (targetId && targetSide) {
            const targetRect = rects.get(targetId);
            if (targetRect) {
              endPt = sideAnchor(targetRect, targetSide);
            }
          }

          return (
            <line
              x1={startWorld.x}
              y1={startWorld.y}
              x2={endPt.x}
              y2={endPt.y}
              stroke="#2196F3"
              strokeWidth={2 / camera.zoom}
              strokeDasharray={`${4 / camera.zoom} ${4 / camera.zoom}`}
              data-testid="connector-preview-line"
            />
          );
        })()}

        {/* Highlighted target dot */}
        {dragStart && targetId && targetSide && (() => {
          const r = rects.get(targetId);
          if (!r) return null;
          const p = sideAnchor(r, targetSide);
          return (
            <circle
              cx={p.x}
              cy={p.y}
              r={dotR * 1.5}
              fill="#FF5722"
              data-testid="connector-dot-highlighted"
            />
          );
        })()}
      </svg>
    </div>
  );
}
