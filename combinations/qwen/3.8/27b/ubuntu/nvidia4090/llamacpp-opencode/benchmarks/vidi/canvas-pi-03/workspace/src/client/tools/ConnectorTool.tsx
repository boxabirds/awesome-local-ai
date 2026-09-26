import { useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import * as Y from 'yjs';
import type { Point } from '@/shared/geometry';
import { CONNECTOR_DOT_RADIUS_PX } from '@/shared/config';
import type { Endpoint } from '@/shared/objects/connector';
import { createConnector } from '@/shared/objects/connector';
import { nearestSide, sideAnchor, type Side } from '@/shared/geometry/connector-geometry';
import { objectBounds, type ObjectSnapshot } from '@/shared/board-model';
import { screenToWorld, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

/**
 * The Connector tool (story 10, conn.hover_points / conn.anchoring): a
 * full-screen overlay above the viewport.
 *
 * - Hovering an object shows the four side-midpoint attachment dots
 *   (connector.hover_points).
 * - Pressing on an object starts a connector ATTACHED to it (at the side
 *   facing the press point); pressing on empty space starts a FREE end.
 * - While dragging, the object under the pointer is the target: its nearest
 *   dot (facing the start point) is highlighted. Releasing on the target
 *   attaches the end there; releasing on empty space frees the end at the
 *   release point.
 * - Rejections (same object at both ends, below min length) create nothing
 *   and keep the tool active (connector.no_accidental / conn.min_length).
 *
 * A successful creation selects the connector and returns to Select
 * (onCreated -> Board's toolCreated).
 */

export interface ConnectorToolProps {
  camera: Camera;
  doc: Y.Doc;
  /** The board's current object snapshot (hit tests + dot positions). */
  snapshot: readonly ObjectSnapshot[];
  createdBy: string;
  onCreated(id: string): void;
  /** Story 8: close the undo capture window around the creation. */
  onBoundary?(): void;
}

interface DotState {
  objectId: string;
  side: Side;
  point: Point;
}

interface DragState {
  from: Endpoint;
  fromPoint: Point;
  /** The target object under the pointer (or null: the end would be free). */
  target: DotState | null;
  toPoint: Point;
}

const DOT_COLOR = 'rgba(26, 115, 232, 0.35)';
const DOT_BORDER = '#1A73E8';
const DOT_ACTIVE = '#1A73E8';
const PREVIEW_COLOR = '#1A73E8';

function hitObject(
  snapshot: readonly ObjectSnapshot[],
  p: Point,
  zoom: number,
  exceptId?: string,
): ObjectSnapshot | undefined {
  // Topmost first: the snapshot is sorted by (z, id) ascending.
  for (let i = snapshot.length - 1; i >= 0; i -= 1) {
    const o = snapshot[i];
    if (o.id === exceptId) continue;
    if (getObjectType(o.type)?.hitTest(o, p, zoom)) return o;
  }
  return undefined;
}

function dotsFor(object: ObjectSnapshot): DotState[] {
  const box = objectBounds(object);
  return (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
    objectId: object.id,
    side,
    point: sideAnchor(box, side),
  }));
}

export function ConnectorTool(props: ConnectorToolProps): ReactElement {
  const { camera, doc, snapshot, onCreated } = props;
  const zoom = camera.zoom;
  const [hoverObject, setHoverObject] = useState<ObjectSnapshot | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const toWorld = (e: ReactPointerEvent): Point =>
    screenToWorld(camera, { x: e.clientX, y: e.clientY });

  const dotScreen = (p: Point): { left: number; top: number } => ({
    left: (p.x - camera.x) * zoom - CONNECTOR_DOT_RADIUS_PX,
    top: (p.y - camera.y) * zoom - CONNECTOR_DOT_RADIUS_PX,
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = toWorld(e);
    const hit = hitObject(snapshot, p, zoom);
    if (hit !== undefined) {
      const box = objectBounds(hit);
      const side = nearestSide(box, p);
      const point = sideAnchor(box, side);
      setDrag({
        from: { kind: 'attached', objectId: hit.id, fallback: point },
        fromPoint: point,
        target: null,
        toPoint: p,
      });
    } else {
      setDrag({
        from: { kind: 'free', x: p.x, y: p.y },
        fromPoint: p,
        target: null,
        toPoint: p,
      });
    }
    setHoverObject(null);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const p = toWorld(e);
    if (drag === null) {
      const hit = hitObject(snapshot, p, zoom);
      setHoverObject(hit ?? null);
      return;
    }
    const fromId = drag.from.kind === 'attached' ? drag.from.objectId : undefined;
    const hit = hitObject(snapshot, p, zoom, fromId);
    let target: DotState | null = null;
    if (hit !== undefined) {
      const box = objectBounds(hit);
      const side = nearestSide(box, drag.fromPoint);
      target = { objectId: hit.id, side, point: sideAnchor(box, side) };
    }
    setDrag({ ...drag, target, toPoint: p });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag === null) return;
    const p = toWorld(e);
    const fromId = drag.from.kind === 'attached' ? drag.from.objectId : undefined;
    const hit = hitObject(snapshot, p, zoom, fromId);
    let to: Endpoint;
    if (hit !== undefined) {
      const box = objectBounds(hit);
      const side = nearestSide(box, drag.fromPoint);
      to = { kind: 'attached', objectId: hit.id, fallback: sideAnchor(box, side) };
    } else {
      to = { kind: 'free', x: p.x, y: p.y };
    }
    setDrag(null);
    props.onBoundary?.();
    // null on rejection: nothing is created, the tool stays active.
    const id = createConnector(doc, drag.from, to, props.createdBy);
    props.onBoundary?.();
    if (id !== null) onCreated(id);
  };

  // Dots to show: the hovered object's four dots, or the drag target's four
  // dots (its nearest one highlighted).
  let dotStates: DotState[] = [];
  let activeSide: Side | null = null;
  if (drag !== null && drag.target !== null) {
    const targetObj = snapshot.find((o) => o.id === drag.target!.objectId);
    if (targetObj !== undefined) {
      dotStates = dotsFor(targetObj);
      activeSide = drag.target.side;
    }
  } else if (hoverObject !== null) {
    dotStates = dotsFor(hoverObject);
  }

  const previewTo = drag?.target !== null && drag !== null ? drag.target.point : drag?.toPoint ?? null;
  const previewFrom = drag?.fromPoint ?? null;

  return (
    <div
      data-testid="connector-tool-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 5, cursor: 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {/* The drag preview line + arrowhead (screen space). */}
      {drag !== null && previewFrom !== null && previewTo !== null && (
        <svg
          data-testid="connector-preview"
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <line
            x1={(previewFrom.x - camera.x) * zoom}
            y1={(previewFrom.y - camera.y) * zoom}
            x2={(previewTo.x - camera.x) * zoom}
            y2={(previewTo.y - camera.y) * zoom}
            stroke={PREVIEW_COLOR}
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        </svg>
      )}
      {dotStates.map((d) => {
        const pos = dotScreen(d.point);
        const active = activeSide === d.side;
        return (
          <div
            key={`${d.objectId}-${d.side}`}
            data-testid="connector-dot"
            data-side={d.side}
            data-object-id={d.objectId}
            data-highlighted={active ? true : undefined}
            style={{
              position: 'absolute',
              left: pos.left,
              top: pos.top,
              width: CONNECTOR_DOT_RADIUS_PX * 2,
              height: CONNECTOR_DOT_RADIUS_PX * 2,
              borderRadius: '50%',
              background: active ? DOT_ACTIVE : DOT_COLOR,
              border: `1px solid ${DOT_BORDER}`,
              pointerEvents: 'none',
            }}
          />
        );
      })}
    </div>
  );
}
