/**
 * Story 10: the Connector tool (connector.ui).
 *
 * A full-viewport layer that CAPTURES every pointer.
 *
 * - hovering over an object shows four connection dots (one per side anchor,
 *   constant screen size CONNECTOR_DOT_RADIUS_PX at any zoom);
 * - a drag from an object attaches the `from` end there; a drag from empty
 *   space starts a free end;
 * - during the drag a dashed preview line follows the pointer, snapping to
 *   the hovered object's side anchor when the pointer is over it (the dot on
 *   the drag-START object stays hidden — a self-connection is impossible);
 * - release: one `createConnector` (the model rejects same-object and
 *   sub-minimum-length arrows before any write — connector.no_accidental),
 *   then `onCreated(id)` selects the arrow and returns to Select;
 * - pointercancel (and Escape) end the drag without creating.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import {
  sideAnchor,
  type Endpoint,
} from 'src/shared/geometry/connector-geometry';
import { nearestSide } from 'src/shared/geometry/connector-geometry';
import {
  CONNECTOR_DOT_RADIUS_PX,
  CONNECTOR_STROKE_WIDTH_WORLD,
} from 'src/shared/config';
import { createConnector } from 'src/shared/objects/connector';
import { objectsOf } from 'src/shared/board-model';
import type { UndoController } from '../board/undo';

export interface ConnectorToolProps {
  camera: Camera;
  doc: Y.Doc;
  identity: string;
  undo: UndoController;
  onCreated(id: string): void;
}

interface HoverState {
  id: string;
  rect: { x: number; y: number; width: number; height: number };
}

interface DragState {
  from: Endpoint;
  current: Point;
}

/** The topmost non-connector object near a world point (dots tolerance). */
function findHover(doc: Y.Doc, world: Point, zoom: number): HoverState | null {
  const tol = CONNECTOR_DOT_RADIUS_PX / Math.max(zoom, 0.01);
  let best: HoverState | null = null;
  let bestZ = -Infinity;
  objectsOf(doc).forEach((obj, key) => {
    if (!(obj instanceof Y.Map)) return;
    if (obj.get('type') === 'connector') return;
    const x = obj.get('x');
    const y = obj.get('y');
    const width = obj.get('width');
    const height = obj.get('height');
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const w = typeof width === 'number' ? width : 0;
    const h = typeof height === 'number' ? height : 0;
    const near =
      world.x >= x - tol &&
      world.x <= x + w + tol &&
      world.y >= y - tol &&
      world.y <= y + h + tol;
    if (!near) return;
    const z = (obj.get('z') as number) ?? 0;
    if (z >= bestZ) {
      bestZ = z;
      best = { id: key as string, rect: { x, y, width: w, height: h } };
    }
  });
  return best;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

export function ConnectorTool(props: ConnectorToolProps): JSX.Element {
  const layerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const rect = layerRef.current?.getBoundingClientRect();
    const ox = rect ? rect.left : 0;
    const oy = rect ? rect.top : 0;
    return { x: e.clientX - ox, y: e.clientY - oy };
  };

  const worldOf = useCallback(
    (client: { clientX: number; clientY: number }): Point => screenToWorld(props.camera, toLocal(client)),
    [props.camera],
  );

  const updateHover = useCallback(
    (client: { clientX: number; clientY: number }) => {
      if (drag) {
        // During a drag the hover is only used for the preview snap: never
        // re-hover the drag-START object (a self-connection is impossible).
        const h = findHover(props.doc, worldOf(client), props.camera.zoom);
        setHover(h && h.id !== (drag.from.kind === 'attached' ? drag.from.objectId : null) ? h : null);
        return;
      }
      setHover(findHover(props.doc, worldOf(client), props.camera.zoom));
    },
    [drag, props.doc, props.camera, worldOf],
  );

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    updateHover(e);
    if (drag) setDrag({ ...drag, current: worldOf(e) });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    layerRef.current?.setPointerCapture(e.pointerId);
    const world = worldOf(e);
    const h = findHover(props.doc, world, props.camera.zoom);
    const from: Endpoint = h
      ? { kind: 'attached', objectId: h.id, fallback: sideAnchor(h.rect, nearestSide(h.rect, world)) }
      : { kind: 'free', x: world.x, y: world.y };
    setDrag({ from, current: world });
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!drag) return;
    if (layerRef.current && layerRef.current.hasPointerCapture(e.pointerId)) {
      layerRef.current.releasePointerCapture(e.pointerId);
    }
    const world = worldOf(e);
    setDrag(null);
    if (cancelled) return;

    const h = findHover(props.doc, world, props.camera.zoom);
    const to: Endpoint =
      h && h.id !== (drag.from.kind === 'attached' ? drag.from.objectId : null)
        ? { kind: 'attached', objectId: h.id, fallback: sideAnchor(h.rect, nearestSide(h.rect, world)) }
        : { kind: 'free', x: world.x, y: world.y };

    // Story 8: one arrow creation is exactly one undo step; the model
    // rejects self / sub-minimum-length arrows before any write.
    props.undo.boundary();
    const id = createConnector(props.doc, drag.from, to, props.identity);
    props.undo.boundary();
    if (id) props.onCreated(id);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => finishDrag(e, false);
  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => finishDrag(e, true);

  // Escape cancels a pending drag (Escape also returns to Select globally).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrag(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The drag-START object's rect (for the live from-anchor while dragging).
  const fromRect: { x: number; y: number; width: number; height: number } | null = (() => {
    if (!drag || drag.from.kind !== 'attached') return null;
    const o = objectsOf(props.doc).get(drag.from.objectId) as Y.Map<unknown> | undefined;
    if (!o || !(o instanceof Y.Map)) return null;
    const x = o.get('x');
    const y = o.get('y');
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    return {
      x,
      y,
      width: (o.get('width') as number) ?? 0,
      height: (o.get('height') as number) ?? 0,
    };
  })();

  // Resolved preview endpoints (screen space).
  let previewFrom: Point | null = null;
  let previewTo: Point | null = null;
  if (drag) {
    const fromPoint: Point =
      drag.from.kind === 'free'
        ? { x: drag.from.x, y: drag.from.y }
        : fromRect
          ? sideAnchor(fromRect, nearestSide(fromRect, drag.current))
          : drag.from.fallback;
    const toPoint: Point =
      hover && fromRect ? sideAnchor(hover.rect, nearestSide(hover.rect, fromPoint)) : drag.current;
    previewFrom = worldToScreen(props.camera, fromPoint);
    previewTo = worldToScreen(props.camera, toPoint);
  }

  const hoverDots: Point[] =
    hover && (!drag || hover.id !== (drag.from.kind === 'attached' ? drag.from.objectId : null))
      ? SIDES.map((s) => worldToScreen(props.camera, sideAnchor(hover.rect, s)))
      : [];

  return (
    <div
      ref={layerRef}
      data-testid="connector-tool-layer"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg width="100%" height="100%" style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
        {hoverDots.map((p, i) => (
          <circle
            key={i}
            data-testid="connector-dot"
            cx={p.x}
            cy={p.y}
            r={CONNECTOR_DOT_RADIUS_PX}
            fill="#FFFFFF"
            stroke="#1A73E8"
            strokeWidth={2}
          />
        ))}
        {previewFrom && previewTo && (
          <line
            data-testid="connector-preview"
            x1={previewFrom.x}
            y1={previewFrom.y}
            x2={previewTo.x}
            y2={previewTo.y}
            stroke="#1A73E8"
            strokeWidth={CONNECTOR_STROKE_WIDTH_WORLD}
            strokeDasharray="6 4"
          />
        )}
      </svg>
    </div>
  );
}
