/**
 * Connector tool (story 10). Hover dots, drag preview, creation.
 */
import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';
import { screenToWorld } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { createConnector } from '../../shared/objects/connector';
import type { Endpoint } from '../../shared/geometry/connector-geometry';
import {
  sideAnchor,
  nearestSide,
} from '../../shared/geometry/connector-geometry';
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Rect, Point } from '../../shared/geometry';
import type * as Y from 'yjs';

interface ConnectorToolProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  onCreated: (id: string) => void;
}

interface HoverState {
  objectId: string;
  rect: Rect;
}

/**
 * Connector tool overlay. Shows hover dots on objects, drag preview line,
 * and creates connectors on release.
 */
export function ConnectorTool(props: ConnectorToolProps): JSX.Element {
  const { camera, snapshot, doc, onCreated } = props;
  const [hover, setHover] = useState<HoverState | null>(null);
  const [dragStart, setDragStart] = useState<{ world: Point; objectId: string | null } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
  const [dragTarget, setDragTarget] = useState<{ objectId: string; side: string } | null>(null);
  const isDragging = useRef(false);

  // Build a map of object rects for hit testing
  const rectsMap = new Map<string, Rect>();
  for (const obj of snapshot) {
    if (obj.type === 'connector') continue;
    const w = obj.width ?? 200;
    const h = obj.height ?? 200;
    rectsMap.set(obj.id, { x: obj.x, y: obj.y, width: w, height: h });
  }

  const hitTest = useCallback((world: Point): string | null => {
    let found: string | null = null;
    rectsMap.forEach((rect, id) => {
      if (
        world.x >= rect.x &&
        world.x <= rect.x + rect.width &&
        world.y >= rect.y &&
        world.y <= rect.y + rect.height
      ) {
        found = id;
      }
    });
    return found;
  }, [snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });

    if (isDragging.current && dragStart) {
      setDragCurrent(world);
      const targetId = hitTest(world);
      if (targetId && targetId !== dragStart.objectId) {
        const rect = rectsMap.get(targetId);
        if (rect) {
          const side = nearestSide(rect, world);
          setDragTarget({ objectId: targetId, side });
        }
      } else {
        setDragTarget(null);
      }
      return;
    }

    // Not dragging: just hover
    const hoverId = hitTest(world);
    if (hoverId) {
      const rect = rectsMap.get(hoverId);
      if (rect) {
        setHover({ objectId: hoverId, rect });
      }
    } else {
      setHover(null);
    }
  }, [camera, dragStart, hitTest]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const objectId = hitTest(world);
    setDragStart({ world, objectId });
    setDragCurrent(world);
    isDragging.current = true;
    setDragTarget(null);
  }, [camera, hitTest]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragStart) return;
    e.preventDefault();
    e.stopPropagation();

    const releaseWorld = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const targetId = hitTest(releaseWorld);

    // Check minimum length
    const length = Math.hypot(releaseWorld.x - dragStart.world.x, releaseWorld.y - dragStart.world.y);

    // Reject: same object or too short
    if (targetId === dragStart.objectId || length < CONNECTOR_MIN_LENGTH_WORLD) {
      // Nothing created, tool stays
      setDragStart(null);
      setDragCurrent(null);
      setDragTarget(null);
      isDragging.current = false;
      return;
    }

    // Build endpoints
    let from: Endpoint;
    let to: Endpoint;

    if (dragStart.objectId) {
      const rect = rectsMap.get(dragStart.objectId);
      const fallback = rect
        ? sideAnchor(rect, nearestSide(rect, releaseWorld))
        : dragStart.world;
      from = { kind: 'attached', objectId: dragStart.objectId, fallback };
    } else {
      from = { kind: 'free', x: dragStart.world.x, y: dragStart.world.y };
    }

    if (targetId) {
      const rect = rectsMap.get(targetId);
      const fallback = rect
        ? sideAnchor(rect, nearestSide(rect, dragStart.world))
        : releaseWorld;
      to = { kind: 'attached', objectId: targetId, fallback };
    } else {
      to = { kind: 'free', x: releaseWorld.x, y: releaseWorld.y };
    }

    const id = createConnector(doc, from, to, 'local');
    if (id) {
      onCreated(id);
    }

    setDragStart(null);
    setDragCurrent(null);
    setDragTarget(null);
    isDragging.current = false;
  }, [camera, dragStart, doc, hitTest, onCreated]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePointerCancel = useCallback(() => {
    setDragStart(null);
    setDragCurrent(null);
    setDragTarget(null);
    isDragging.current = false;
  }, []);

  // Render hover dots
  const renderDots = (rect: Rect, objectId: string, highlightedSide?: string) => {
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    return sides.map((side) => {
      const pt = sideAnchor(rect, side);
      const screen = {
        x: (pt.x - camera.x) * camera.zoom,
        y: (pt.y - camera.y) * camera.zoom,
      };
      const isHighlighted = highlightedSide === side;
      return (
        <circle
          key={side}
          data-testid={`conn-dot-${objectId}-${side}`}
          cx={screen.x}
          cy={screen.y}
          r={isHighlighted ? CONNECTOR_DOT_RADIUS_PX + 2 : CONNECTOR_DOT_RADIUS_PX}
          fill={isHighlighted ? '#1a73e8' : 'white'}
          stroke="#1a73e8"
          strokeWidth={1.5}
        />
      );
    });
  };

  // Render drag preview line
  const renderPreview = () => {
    if (!dragStart || !dragCurrent) return null;
    const fromScreen = {
      x: (dragStart.world.x - camera.x) * camera.zoom,
      y: (dragStart.world.y - camera.y) * camera.zoom,
    };
    const toScreen = {
      x: (dragCurrent.x - camera.x) * camera.zoom,
      y: (dragCurrent.y - camera.y) * camera.zoom,
    };
    return (
      <line
        x1={fromScreen.x}
        y1={fromScreen.y}
        x2={toScreen.x}
        y2={toScreen.y}
        stroke="#1a73e8"
        strokeWidth={2}
        strokeDasharray="4 3"
      />
    );
  };

  return (
    <svg
      data-testid="connector-tool-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'all',
        cursor: 'crosshair',
        zIndex: 50,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* Hover dots */}
      {hover && !isDragging.current && renderDots(hover.rect, hover.objectId)}
      {/* Drag target dots */}
      {dragTarget && (
        (() => {
          const rect = rectsMap.get(dragTarget.objectId);
          return rect ? renderDots(rect, dragTarget.objectId, dragTarget.side) : null;
        })()
      )}
      {/* Drag preview line */}
      {renderPreview()}
    </svg>
  );
}
