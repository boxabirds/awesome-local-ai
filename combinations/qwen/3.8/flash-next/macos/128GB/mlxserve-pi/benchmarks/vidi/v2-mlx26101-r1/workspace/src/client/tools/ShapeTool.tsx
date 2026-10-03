// The Shape tool (story 10, shape.*): press and drag on the board, let go, and a shape is
// there; hold it down and make another; one Escape puts the tool down.
//
// It moves, selects and deletes nothing except by creating a shape, and it writes nothing
// until the drag ends — one write, one undo step (shape.create). Selecting, moving,
// resizing, deleting and undoing a finished shape are the stories 7 and 8 gestures, reached
// because the new object is registered in the registry: there is no second path in here.
//
// Three things are worth the explanation:
//
// 1. The layer covers the whole board and takes pointer events while the tool is held, so
//    this layer — not the object underneath — is what the pointer is really on. That is why
//    "what am I pressing?" is answered from the data (see `objectAtPoint`), and why the
//    press stops here: it must never pan the board, start a marquee, or pull an object out
//    from under the shape that is about to be drawn over it.
//
// 2. A press that lands on an existing object selects that object and draws nothing
//    (shape.behind), because "shapes go behind the thing already there" is the only rule
//    that never surprises anyone about z-order.
//
// 3. The preview is local state, thrown away on release. An unfinished shape is in nobody's
//    document, so a colleague cannot see it, undo cannot reach it, and a reload cannot bring
//    it back (shape.escape).

import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import type { Point, Rect } from '../../shared/geometry';
import { normalizeRect } from '../../shared/geometry';
import { screenToWorld } from '../canvas/camera';
import type { SelectionApi } from '../board/useSelection';
import { useWindowPointer } from './useWindowPointer';
import { localPoint, toolLayerStyle } from './toolSurface';
import { topObjectIdAt } from './objectAtPoint';
import { objectSnapshots } from '../../shared/board-model';
import { shapeRect, type ShapeCreation } from '../../shared/objects/shape';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  type ShapeKind,
} from '../../shared/config';
import { ShapeFigure } from '../objects/ShapeObject';

export interface ShapeToolProps {
  doc: Y.Doc;
  /** The board's surface element, for turning client points into board points. */
  surface: HTMLElement | null;
  /** The camera as it is rendered — the same object the board painted with. */
  camera: Camera;
  canEdit: boolean;
  /** Whether this tool is the tool the board is holding. */
  active: boolean;
  selection: SelectionApi;
  /** The kind the rail's menu says to draw (shape.menu). */
  shapeKind: ShapeKind;
  /**
   * Write the shape, in the words the model itself takes: where the pointer went down, what
   * it dragged, whether Shift was held, which kind. Returns the new id, or null when the
   * model refused it — a box with a NaN in it is refused there, before any transaction is
   * opened. The box that gets stored is the model's `shapeRect`, which is why the preview
   * below asks the same function what it will look like.
   */
  onCreate(a: Omit<ShapeCreation, 'kind'> & { kind: ShapeKind }): string | null;
  /** A shape was created: it becomes the selection and the board returns to Select. */
  onCreated(id: string): void;
}

interface Preview {
  kind: ShapeKind;
  /** The shape's box on the screen, while it is being dragged. */
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DragState {
  pointerId: number;
  /** Board-local point the press started at. */
  origin: Point;
  /** The world point the press started at: the centre of the box a click gets. */
  anchor: Point;
  /** True once the pointer left the button's slop: from then on the drag is a size. */
  moved: boolean;
  /** The box the preview is showing, as drawn (Shift is applied on top of it). */
  rect: Rect;
}

/** The button slop, in screen pixels: under it a press is a click, not a drag. */
const DRAG_SLOP_PX = 3;

export function ShapeTool({
  doc,
  surface,
  camera,
  canEdit,
  active,
  selection,
  shapeKind,
  onCreate,
  onCreated,
}: ShapeToolProps) {
  // The camera and the kind are read from refs refreshed on every render, so a listener
  // bound once for the mount never converts a point with the camera that happened to be
  // current when it was bound.
  const live = useRef({ camera, shapeKind, surface });
  live.current = { camera, shapeKind, surface };

  const dragRef = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  /** The world box between two board points, as drawn (Shift is the model's business). */
  const rectBetween = useCallback((a: Point, b: Point): Rect => {
    return normalizeRect(screenToWorld(live.current.camera, a), screenToWorld(live.current.camera, b));
  }, []);

  const showPreview = useCallback((rect: Rect, kind: ShapeKind) => {
    const cam = live.current.camera;
    setPreview({
      kind,
      left: cam.x + rect.x * cam.zoom,
      top: cam.y + rect.y * cam.zoom,
      width: Math.abs(rect.width) * cam.zoom,
      height: Math.abs(rect.height) * cam.zoom,
    });
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setPreview(null);
  }, []);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const here = localPoint(live.current.surface, e);
      if (
        !drag.moved &&
        Math.hypot(here.x - drag.origin.x, here.y - drag.origin.y) < DRAG_SLOP_PX
      ) {
        return;
      }
      drag.moved = true;
      drag.rect = rectBetween(drag.origin, here);
      // The preview is the box the model would store — the same `shapeRect`, asked with the
      // same three inputs — so what a person drags out is literally what appears.
      showPreview(shapeRect(drag.rect, drag.anchor, e.shiftKey), live.current.shapeKind);
    },
    [rectBetween, showPreview],
  );

  const onUp = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      // The release event carries the pointer's last position, and that is the box the
      // shape gets: a fast release can arrive without a final pointermove, and a shape that
      // stopped short of where the hand actually let go would be a shape in the wrong place.
      const here = localPoint(live.current.surface, e);
      const travelled = Math.hypot(here.x - drag.origin.x, here.y - drag.origin.y);
      const moved = drag.moved || travelled >= DRAG_SLOP_PX;
      // A release that never moved is a click, and the model turns a click into a shape of
      // the default size centred on the point (shape.create_click): the tool never asks a
      // hand for the precision of a mouse.
      const rect = moved ? rectBetween(drag.origin, here) : null;
      endDrag();
      const id = onCreate({
        kind: live.current.shapeKind,
        at: drag.anchor,
        rect,
        square: e.shiftKey,
      });
      if (id) onCreated(id);
    },
    [endDrag, onCreate, onCreated, rectBetween],
  );

  useWindowPointer({ onMove, onUp, onCancel: endDrag });

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!active || !canEdit || e.button !== 0) return;
      // This press belongs to the tool: it must not pan the board, start a marquee or
      // drag an object out from under the shape about to cover it.
      e.stopPropagation();
      const cam = live.current.camera;
      const point = localPoint(live.current.surface, e);
      const world = screenToWorld(cam, point);

      // Press on an existing object: select it and draw nothing (shape.behind). The layer
      // is what the pointer is on, so this is a hit-test of the object boxes rather than of
      // the DOM — and it is the same boxes story 7 selects and moves by.
      const hit = topObjectIdAt(objectSnapshots(doc), world);
      if (hit !== null) {
        // An idle press on a shape (or a note) selects it like the Select tool would;
        // pressing what is already selected leaves a Shift-selection alone.
        if (!selection.ids.has(hit)) {
          if (e.shiftKey) selection.toggle(hit);
          else selection.click(hit);
        }
        return;
      }

      dragRef.current = {
        pointerId: e.pointerId,
        origin: point,
        anchor: world,
        moved: false,
        rect: normalizeRect(world, world),
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      showPreview(shapeRect(null, world, false), shapeKind);
    },
    [active, canEdit, doc, selection, showPreview, shapeKind],
  );

  return (
    <div
      data-testid="shape-tool-layer"
      className="tool-layer shape-tool-layer"
      aria-hidden="true"
      style={toolLayerStyle(active, 'crosshair')}
      onPointerDown={onPointerDown}
      // Two quick clicks are two shapes, not one shape plus a sticky note: story 9's
      // double-click-to-create has nothing to say while a story 10 tool is held.
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {preview ? (
        <div
          data-testid="shape-preview"
          data-shape-kind={preview.kind}
          data-fill={DEFAULT_SHAPE_FILL}
          data-stroke={DEFAULT_SHAPE_STROKE}
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: preview.left,
            top: preview.top,
            width: preview.width,
            height: preview.height,
            boxSizing: 'border-box',
            opacity: 0.7,
            pointerEvents: 'none',
          }}
        >
          {/* The same SVG the shape itself is drawn with, at the same colours and the same
              screen thickness: what is being dragged is literally the thing that appears,
              which is why there is a diamond preview and not a square with a note. */}
          <svg
            width={preview.width}
            height={preview.height}
            viewBox={`0 0 ${preview.width} ${preview.height}`}
            style={{ display: 'block', overflow: 'visible' }}
          >
            <g
              // The colours a new shape is born with, from the same constants the model
              // writes, and the same stroke thickness scaled up with the board.
              fill={DEFAULT_SHAPE_FILL === 'none' ? 'none' : SHAPE_FILL_COLORS[DEFAULT_SHAPE_FILL]}
              stroke={SHAPE_STROKE_COLORS[DEFAULT_SHAPE_STROKE]}
              strokeWidth={Math.max(SHAPE_STROKE_WIDTH_WORLD * camera.zoom, 1)}
              strokeLinejoin="round"
            >
              <ShapeFigure kind={preview.kind} w={preview.width} h={preview.height} sw={Math.max(SHAPE_STROKE_WIDTH_WORLD * camera.zoom, 1)} />
            </g>
          </svg>
        </div>
      ) : null}
    </div>
  );
}
