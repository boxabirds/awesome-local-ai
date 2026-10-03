/**
 * Connector tool overlay (story 10, connector.tool).
 *
 * Full-screen capture layer while the Connector tool is active:
 * - the drag starts from the object under the pointer (attached end) or from
 *   a free point in empty space
 * - the cursor shows a line preview toward the current point, and the object
 *   under the pointer is highlighted (connector.hover)
 * - on release, the target end attaches to the hovered object (or becomes a
 *   free end); arrows shorter than CONNECTOR_MIN_LENGTH_WORLD are not
 *   created
 * The just-created arrow is selected and the tool returns to Select.
 */

import { useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import {
  nearestSide,
  sideAnchor,
  type Side,
} from '../../shared/geometry/connector-geometry';
import type { Rect } from '../../shared/geometry';
import type { Endpoint } from '../../shared/objects/connector';

interface ConnectorToolProps {
  camera: Camera;
  objects: readonly ObjectSnapshot[];
  /** Create the connector in the doc; returns the new id or null when rejected. */
  onCreate(from: Endpoint, to: Endpoint): string | null;
  onCreated(id: string): void;
}

/** The topmost non-connector object under a world point (excluding `exclude`). */
function hitObject(
  objects: readonly ObjectSnapshot[],
  p: Point,
  exclude: string | undefined,
): ObjectSnapshot | undefined {
  let best: ObjectSnapshot | undefined;
  for (const o of objects) {
    if (o.id === exclude) continue;
    if (o.type === 'connector') continue;
    const b = objectBounds(o);
    if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) {
      if (!best || o.z >= best.z) best = o;
    }
  }
  return best;
}

/** The side anchor of `rect` facing `reference` (for endpoint fallbacks). */
function anchorToward(rect: Rect, reference: Point): Point {
  return sideAnchor(rect, nearestSide(rect, reference));
}

interface DragState {
  from: Endpoint;
  current: Point;
  hover: ObjectSnapshot | undefined;
}

export function ConnectorTool({ camera, objects, onCreate, onCreated }: ConnectorToolProps): JSX.Element {
  const [drag, setDrag] = useState<DragState | null>(null);

  const toWorld = (e: { clientX: number; clientY: number }): Point =>
    screenToWorld(camera, { x: e.clientX, y: e.clientY });

  const startDragAt = (p: Point): DragState => {
    const target = hitObject(objects, p, undefined);
    const from: Endpoint = target
      ? { kind: 'attached', objectId: target.id, fallback: anchorToward(objectBounds(target), p) }
      : { kind: 'free', x: p.x, y: p.y };
    return { from, current: p, hover: undefined };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag(startDragAt(toWorld(e)));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const p = toWorld(e);
    const hover = hitObject(objects, p, drag.from.kind === 'attached' ? drag.from.objectId : undefined);
    setDrag({ ...drag, current: p, hover });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const p = toWorld(e);
    const hover = hitObject(objects, p, drag.from.kind === 'attached' ? drag.from.objectId : undefined);
    const to: Endpoint = hover
      ? { kind: 'attached', objectId: hover.id, fallback: anchorToward(objectBounds(hover), p) }
      : { kind: 'free', x: p.x, y: p.y };
    const id = onCreate(drag.from, to);
    setDrag(null);
    if (id) onCreated(id);
  };

  // Preview: the resolved start anchor (live, facing the cursor) → cursor.
  let previewFrom: Point | null = null;
  if (drag) {
    const from = drag.from;
    if (from.kind === 'attached') {
      const rect = objects.find((o) => o.id === from.objectId);
      previewFrom = rect
        ? anchorToward(objectBounds(rect), drag.current)
        : from.fallback;
    } else {
      previewFrom = { x: from.x, y: from.y };
    }
  }
  const s1 = previewFrom ? worldToScreen(camera, previewFrom) : null;
  const s2 = drag ? worldToScreen(camera, drag.current) : null;
  const hoverRect = drag?.hover ? objectBounds(drag.hover) : undefined;
  // Side-anchor dots on the hover target (connector.hover).
  const hoverDots = hoverRect
    ? (['top', 'right', 'bottom', 'left'] as Side[]).map((side) =>
        worldToScreen(camera, sideAnchor(hoverRect, side)),
      )
    : [];

  return (
    <div
      data-testid="connector-tool"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'crosshair',
        zIndex: 5,
        touchAction: 'none',
      }}
    >
      {(s1 && s2) || hoverRect ? (
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
          {hoverRect && (
            <g>
              <rect
                x={(hoverRect.x - camera.x) * camera.zoom}
                y={(hoverRect.y - camera.y) * camera.zoom}
                width={hoverRect.width * camera.zoom}
                height={hoverRect.height * camera.zoom}
                fill="none"
                stroke="#1a73e8"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              {hoverDots.map((d, i) => (
                <circle key={i} cx={d.x} cy={d.y} r={4} fill="#fff" stroke="#1a73e8" strokeWidth={1.5} />
              ))}
            </g>
          )}
          {s1 && s2 && (
            <line
              x1={s1.x}
              y1={s1.y}
              x2={s2.x}
              y2={s2.y}
              stroke="#6b7280"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
          )}
        </svg>
      ) : null}
    </div>
  );
}
