// The Shape tool (story 10, shape.create_drag / shape.create_click /
// shape.constrain): a screen-space overlay above the board world while the
// tool is active. A drag draws a live dashed preview and creates the shape
// on release; a click (or a drag below the minimum size) creates the
// standard square centred on the point; Shift constrains to a square
// anchored at the drag origin.
//
// The overlay captures ALL pointer events while the tool is active, so a
// drag that starts over a sticky note draws a shape and does not move the
// note (shape.tool_isolation, TC-28).

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import * as Y from 'yjs';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  type ShapeKind,
} from '../../shared/config';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { createShape } from '../../shared/objects/shape';

export interface ShapeToolProps {
  /** The Shape tool's selected kind (Rectangle / Ellipse / Diamond). */
  kind: ShapeKind;
  /** The shared camera (screen ↔ world). */
  camera: Camera;
  /** The board doc (the created shape is written here). */
  doc: Y.Doc;
  /** The creator identity (createdBy). */
  createdBy: string;
  /** Undo boundary marker (one creation = one undo step). */
  onBoundary(): void;
  /** A shape was created: select it and switch back to Select. */
  onCreated(id: string): void;
}

interface DragState {
  startWorld: Point;
  current: Point;
  square: boolean;
}

/** The world rect of a drag (null while the drag is below the minimum size
 *  — the release then creates the standard square on the point). `square`
 *  (Shift) anchors both sides at the drag origin (rect top-left). */
function dragRect(start: Point, end: Point, square: boolean): Rect | null {
  const r = normalizeRect(start, end);
  if (r.width < SHAPE_MIN_SIZE_WORLD || r.height < SHAPE_MIN_SIZE_WORLD) return null;
  if (!square) return r;
  const s = Math.max(r.width, r.height);
  return { x: r.x, y: r.y, width: s, height: s };
}

/** The preview outline for a kind inside `box` (world coordinates). */
function previewOutline(kind: ShapeKind, box: Rect, sw: number): { points: string | null; ellipse: boolean; rect: boolean } {
  const { x, y, width: w, height: h } = box;
  if (kind === 'ellipse') return { points: null, ellipse: true, rect: false };
  void x;
  void y;
  if (kind === 'diamond') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    return {
      points: `${cx},${y + sw / 2} ${x + w - sw / 2},${cy} ${cx},${y + h - sw / 2} ${x + sw / 2},${cy}`,
      ellipse: false,
      rect: false,
    };
  }
  return { points: null, ellipse: false, rect: true };
}

export function ShapeTool(props: ShapeToolProps): ReactElement {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const world = screenToWorld(props.camera, toLocal(e));
    setDrag({ startWorld: world, current: world, square: e.shiftKey });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (d === null) return;
    setDrag({ ...d, current: screenToWorld(props.camera, toLocal(e)), square: e.shiftKey });
  };

  const releaseCapture = (e: ReactPointerEvent<HTMLDivElement>): void => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Already released (pointercancel); harmless.
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (d === null) return;
    releaseCapture(e);
    setDrag(null);
    const world = screenToWorld(props.camera, toLocal(e));
    const rect = dragRect(d.startWorld, world, d.square);
    // One creation is one undo step (boundary before and after, undo.steps).
    props.onBoundary();
    const id = createShape(
      props.doc,
      { kind: props.kind, rect, at: rect === null ? world : d.startWorld, square: d.square },
      props.createdBy,
    );
    if (id !== null) props.onCreated(id);
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>): void => {
    releaseCapture(e);
    setDrag(null);
  };

  // The live preview (screen space).
  let preview: { box: Rect; kind: ShapeKind } | null = null;
  if (drag !== null) {
    const r = dragRect(drag.startWorld, drag.current, drag.square);
    if (r !== null) {
      preview = { box: r, kind: props.kind };
    } else {
      // Below the minimum: the click will create the standard square.
      const side = SHAPE_DEFAULT_SIZE_WORLD;
      preview = {
        box: {
          x: drag.startWorld.x - side / 2,
          y: drag.startWorld.y - side / 2,
          width: side,
          height: side,
        },
        kind: props.kind,
      };
    }
  }

  return (
    <div
      ref={overlayRef}
      className="shape-tool"
      data-testid="shape-tool"
      data-kind={props.kind}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {preview !== null && (
        <svg className="shape-tool-preview" width="100%" height="100%" aria-hidden="true">
          {(() => {
            const s0 = worldToScreen(props.camera, { x: preview.box.x, y: preview.box.y });
            const w = preview.box.width * props.camera.zoom;
            const h = preview.box.height * props.camera.zoom;
            const sw = Math.max(1, 2 * props.camera.zoom);
            const o = previewOutline(preview.kind, preview.box, sw / props.camera.zoom);
            const stroke = '#1E88E5';
            if (o.ellipse) {
              return (
                <ellipse
                  cx={s0.x + w / 2}
                  cy={s0.y + h / 2}
                  rx={w / 2}
                  ry={h / 2}
                  fill="rgba(30, 136, 229, 0.08)"
                  stroke={stroke}
                  strokeWidth={sw}
                  strokeDasharray={`${6 * props.camera.zoom} ${4 * props.camera.zoom}`}
                />
              );
            }
            if (o.points !== null) {
              // Diamond: world points → screen.
              const pts = o.points
                .split(' ')
                .map((p) => {
                  const [wx, wy] = p.split(',').map(Number);
                  const s = worldToScreen(props.camera, { x: wx, y: wy });
                  return `${s.x},${s.y}`;
                })
                .join(' ');
              return (
                <polygon
                  points={pts}
                  fill="rgba(30, 136, 229, 0.08)"
                  stroke={stroke}
                  strokeWidth={sw}
                  strokeDasharray={`${6 * props.camera.zoom} ${4 * props.camera.zoom}`}
                />
              );
            }
            return (
              <rect
                x={s0.x}
                y={s0.y}
                width={w}
                height={h}
                fill="rgba(30, 136, 229, 0.08)"
                stroke={stroke}
                strokeWidth={sw}
                strokeDasharray={`${6 * props.camera.zoom} ${4 * props.camera.zoom}`}
              />
            );
          })()}
        </svg>
      )}
    </div>
  );
}
