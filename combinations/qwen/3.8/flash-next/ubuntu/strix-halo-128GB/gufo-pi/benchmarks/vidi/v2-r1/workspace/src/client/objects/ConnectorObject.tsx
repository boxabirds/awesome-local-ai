/**
 * ConnectorObject: renders an SVG line with an arrowhead between two resolved endpoints.
 * Shows end handles when selected for re-attaching.
 */

import { useCallback, useRef, useState, type JSX } from 'react';

import type { ConnectorSnap } from '../../shared/objects/connector';
import { setConnectorEndpoint } from '../../shared/objects/connector';
import { resolveEndpoints, nearestSide, sideAnchor } from '../../shared/geometry/connector-geometry';
import type { Rect } from '../../shared/geometry';
import type { Point, ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import {
  CONNECTOR_STROKE_WIDTH_WORLD,
  CONNECTOR_ARROWHEAD_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
} from '../../shared/config';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';

export interface ConnectorObjectProps {
  connector: ConnectorSnap;
  rects: ReadonlyMap<string, Rect>;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  camera: Camera;
  zoom: number;
  selected: boolean;
  canEdit: boolean;
  undoBoundary(): void;
  onSelect(id: string): void;
}

export function ConnectorObject(props: ConnectorObjectProps): JSX.Element {
  const { connector, rects, snapshot, doc, camera, zoom, selected, canEdit, undoBoundary, onSelect } = props;

  const resolved = resolveEndpoints(connector, rects);

  // Convert to screen coords for SVG
  const fromScreen = worldToScreen(camera, resolved.from);
  const toScreen = worldToScreen(camera, resolved.to);

  // Arrowhead calculation
  const angle = Math.atan2(toScreen.y - fromScreen.y, toScreen.x - fromScreen.x);
  const arrowLen = CONNECTOR_ARROWHEAD_SIZE_WORLD * zoom;
  const arrowAngle = Math.PI / 6;

  const arrowX1 = toScreen.x - arrowLen * Math.cos(angle - arrowAngle);
  const arrowY1 = toScreen.y - arrowLen * Math.sin(angle - arrowAngle);
  const arrowX2 = toScreen.x - arrowLen * Math.cos(angle + arrowAngle);
  const arrowY2 = toScreen.y - arrowLen * Math.sin(angle + arrowAngle);

  // Handle drag state for re-attach
  const [handleDrag, setHandleDrag] = useState<{ end: 'from' | 'to'; point: Point } | null>(null);
  const handlePointerId = useRef<number | null>(null);

  const handleLineClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(connector.id);
  }, [connector.id, onSelect]);

  const startHandleDrag = useCallback((end: 'from' | 'to') => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    handlePointerId.current = e.pointerId;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    setHandleDrag({ end, point: world });

    const onMove = (ev: PointerEvent) => {
      if (handlePointerId.current !== ev.pointerId) return;
      const w = screenToWorld(camera, { x: ev.clientX, y: ev.clientY });
      setHandleDrag({ end, point: w });
    };

    const onUp = (ev: PointerEvent) => {
      if (handlePointerId.current !== ev.pointerId) return;
      handlePointerId.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setHandleDrag(null);

      const endWorld = screenToWorld(camera, { x: ev.clientX, y: ev.clientY });
      let targetId: string | null = null;
      for (let i = snapshot.length - 1; i >= 0; i--) {
        const obj = snapshot[i];
        if (obj.type === 'connector') continue;
        const bounds = objectBounds(obj);
        if (endWorld.x >= bounds.x && endWorld.y >= bounds.y &&
            endWorld.x <= bounds.x + bounds.width && endWorld.y <= bounds.y + bounds.height) {
          targetId = obj.id;
          break;
        }
      }

      // Check if it's the object at the opposite end
      if (targetId) {
        const otherEnd = end === 'from' ? connector.to : connector.from;
        if (otherEnd.kind === 'attached' && otherEnd.objectId === targetId) {
          return; // snap back
        }
      }

      undoBoundary();
      if (targetId) {
        const targetObj = snapshot.find((s) => s.id === targetId);
        const bounds = targetObj ? objectBounds(targetObj) : { x: endWorld.x, y: endWorld.y, width: 100, height: 100 };
        const otherPt = end === 'from' ? resolved.to : resolved.from;
        const side = nearestSide(bounds, otherPt);
        const anchor = sideAnchor(bounds, side);
        setConnectorEndpoint(doc, connector.id, end, { kind: 'attached', objectId: targetId, fallback: anchor });
      } else {
        setConnectorEndpoint(doc, connector.id, end, { kind: 'free', x: endWorld.x, y: endWorld.y });
      }
      undoBoundary();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [canEdit, camera, connector, doc, resolved, snapshot, undoBoundary]);

  const handleSize = 8;
  const fromHandleScreen = handleDrag?.end === 'from' ? worldToScreen(camera, handleDrag.point) : fromScreen;
  const toHandleScreen = handleDrag?.end === 'to' ? worldToScreen(camera, handleDrag.point) : toScreen;

  return (
    <svg
      className="connector-object"
      data-testid={`connector-${connector.id}`}
      data-connector-id={connector.id}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: connector.z,
      }}
    >
      {/* Clickable thick invisible line for selection */}
      <line
        x1={fromScreen.x}
        y1={fromScreen.y}
        x2={toScreen.x}
        y2={toScreen.y}
        stroke="transparent"
        strokeWidth={Math.max(CONNECTOR_HIT_TOLERANCE_PX * 2, 12)}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onClick={handleLineClick}
        data-testid={`connector-hit-${connector.id}`}
      />
      {/* Visible line */}
      <line
        x1={fromScreen.x}
        y1={fromScreen.y}
        x2={toScreen.x}
        y2={toScreen.y}
        stroke="#263238"
        strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD * zoom}
      />
      {/* Arrowhead */}
      <polygon
        points={`${toScreen.x},${toScreen.y} ${arrowX1},${arrowY1} ${arrowX2},${arrowY2}`}
        fill="#263238"
      />
      {/* End handles when selected */}
      {selected && (
        <>
          <rect
            data-testid={`connector-handle-from-${connector.id}`}
            x={fromHandleScreen.x - handleSize / 2}
            y={fromHandleScreen.y - handleSize / 2}
            width={handleSize}
            height={handleSize}
            fill="#fff"
            stroke="#1E88E5"
            strokeWidth={1.5}
            style={{ pointerEvents: 'all', cursor: 'crosshair' }}
            onPointerDown={startHandleDrag('from')}
          />
          <rect
            data-testid={`connector-handle-to-${connector.id}`}
            x={toHandleScreen.x - handleSize / 2}
            y={toHandleScreen.y - handleSize / 2}
            width={handleSize}
            height={handleSize}
            fill="#fff"
            stroke="#1E88E5"
            strokeWidth={1.5}
            style={{ pointerEvents: 'all', cursor: 'crosshair' }}
            onPointerDown={startHandleDrag('to')}
          />
        </>
      )}
    </svg>
  );
}
