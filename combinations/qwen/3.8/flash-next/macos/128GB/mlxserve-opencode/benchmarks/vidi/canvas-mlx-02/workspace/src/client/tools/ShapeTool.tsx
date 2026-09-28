// The Shape tool (story 10, shape.create_drag).
//
// It is a full-board surface, not a cursor hint: while it is active it is the
// only thing that sees a press, so a drag that starts on top of an existing
// object sizes a NEW shape instead of moving that object (TC-28), and the
// camera never pans and no marquee is drawn underneath. That is the same
// arrangement story 9's Text tool reached with the viewport, only owned by the
// tool itself, because a shape needs a drag of its own rather than a click.
//
// What it does with a gesture is small on purpose: read the pressed points in
// world units, show a dashed outline while the pointer moves, and on release
// hand the answer to the shape model - which owns every decision about what a
// click, a sliver and Shift mean. The tool then hands the board back through
// `onCreated`, which is where the "return to Select" of the requirement happens.
import { useRef, useState } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import { createShape } from '../../shared/objects/shape.ts';
import { normalizeRect } from '../../shared/geometry.ts';
import type { Point, Rect } from '../../shared/geometry.ts';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera.ts';
import { DRAG_THRESHOLD_PX, SHAPE_MIN_SIZE_WORLD } from '../../shared/config.ts';
import type { ShapeKind } from '../../shared/config.ts';
import { localIdentityId } from '../board/localIdentity.ts';
import { useUndoController } from '../board/useUndo.ts';

export interface ShapeToolProps {
  /** the kind the Shape menu picked (shape.kind_menu) */
  kind: ShapeKind;
  /** the live camera: a screen point means a board point only through it */
  camera: Camera;
  /** the board to write to (the tool is only ever mounted on an editable board) */
  doc: Y.Doc;
  /** a shape was created: select it and hand the tool back to Select */
  onCreated(id: string): void;
}

interface Drag {
  start: Point;
  startScreen: Point;
  moved: boolean;
}

export function ShapeTool(props: ShapeToolProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);

  // The handlers are installed once per mount and read the CURRENT props through
  // a ref, so a camera that moved mid-drag (a wheel over the tool) cannot be
  // missed by a stale closure.
  const latest = useRef(props);
  latest.current = props;
  const undo = useUndoController();

  const screenPoint = (e: { clientX: number; clientY: number }): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const worldOf = (e: { clientX: number; clientY: number }): Point =>
    screenToWorld(latest.current.camera, screenPoint(e));

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current) return;
    // The press belongs to the tool: nothing below it - an object, the pan, the
    // marquee - is ever told about it.
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom / unsupported */
    }
    const start = worldOf(e);
    drag.current = { start, startScreen: screenPoint(e), moved: false };
    setPreview({ x: start.x, y: start.y, width: 0, height: 0 });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const point = screenPoint(e);
    const world = screenToWorld(latest.current.camera, point);
    if (!d.moved && Math.hypot(point.x - d.startScreen.x, point.y - d.startScreen.y) >= DRAG_THRESHOLD_PX) {
      d.moved = true;
    }
    // Shift squares the dragged area on its longer side; the shift state is read
    // on EVERY move, so pressing it mid-drag changes the outline at once.
    let rect = normalizeRect(d.start, world);
    if (e.shiftKey) {
      const side = Math.max(rect.width, rect.height);
      rect = { x: rect.x, y: rect.y, width: side, height: side };
    }
    setPreview(rect);
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, create: boolean): void => {
    const d = drag.current;
    drag.current = null;
    setPreview(null);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* jsdom / unsupported */
    }
    if (!d || !create) return;

    const world = worldOf(e);
    let rect = normalizeRect(d.start, world);
    if (e.shiftKey) {
      const side = Math.max(rect.width, rect.height);
      rect = { x: rect.x, y: rect.y, width: side, height: side };
    }
    // A press that never moved, or an area too small to be a shape, is a CLICK:
    // the model lands the standard size centred on the pressed point.
    const click = !d.moved || rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD;

    // The two boundaries make "a shape was created" one undo step of its own,
    // so an accidental drag is undone in one press of Ctrl+Z.
    undo?.boundary();
    const id = createShape(
      latest.current.doc,
      {
        kind: latest.current.kind,
        rect: click ? null : rect,
        at: d.start,
        square: e.shiftKey,
      },
      localIdentityId(),
    );
    undo?.boundary();
    if (id !== null) latest.current.onCreated(id);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => finish(e, true);
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => finish(e, false);

  const cam = props.camera;
  const shown = preview
    ? {
        left: worldToScreen(cam, { x: preview.x, y: preview.y }),
        width: Math.max(0, preview.width) * cam.zoom,
        height: Math.max(0, preview.height) * cam.zoom,
      }
    : null;

  return (
    <div
      ref={rootRef}
      data-testid="shape-tool"
      data-kind={props.kind}
      role="presentation"
      aria-label="Shape tool: drag to draw a shape"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={(e) => {
        // A double-click is two shape presses, never the board's "new note".
        e.stopPropagation();
      }}
    >
      {shown ? (
        <div
          data-testid="shape-preview"
          data-kind={props.kind}
          data-world-x={preview!.x}
          data-world-y={preview!.y}
          data-world-width={preview!.width}
          data-world-height={preview!.height}
          style={{
            position: 'fixed',
            left: `${shown.left.x}px`,
            top: `${shown.left.y}px`,
            width: `${shown.width}px`,
            height: `${shown.height}px`,
            border: '1px dashed #2563eb',
            background: 'rgba(37, 99, 235, 0.08)',
            borderRadius: props.kind === 'ellipse' ? '50%' : 0,
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
}
