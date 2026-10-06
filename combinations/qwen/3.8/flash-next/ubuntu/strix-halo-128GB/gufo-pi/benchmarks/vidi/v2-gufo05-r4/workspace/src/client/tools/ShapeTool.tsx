/**
 * The Shape tool: the surface that turns a drag into a shape (`shape.create_drag`).
 *
 * It is an overlay rather than a behaviour added to the viewport, and that is the whole
 * design of it. While a tool that creates things is held, the pointer belongs to the tool —
 * every point on the board is a place to start drawing, including a point that happens to be
 * on top of something already there. A component that covered the board says so in one place;
 * the alternative, teaching every object to step aside, would leave a rule to remember in
 * every object type this project adds (TC-28).
 *
 * What happens to the gesture:
 *
 *  - **press, move, release** draws a shape exactly covering the dragged box;
 *  - **a drag too small to be a shape is a click** and drops a standard shape where the pointer
 *    went down (`shape.create_click`). The threshold is the model's, not this component's, and
 *    the dashed preview is drawn from the same function as the shape is created — so what the
 *    tool promised and what it made cannot be different rectangles;
 *  - **Shift squares it** as you drag, not only at the end (`shape.constrain`), because the
 *    shape you see is the shape you get;
 *  - **release, and the tool is spent**: the new shape is selected and the pointer goes back to
 *    Select (`tools.return_to_select`), so it can be moved, resized or labelled straight away;
 *  - **a cancelled pointer, or Escape, makes nothing.** Escape leaves the tool, which unmounts
 *    this component, and an unmounted gesture writes nothing — including a drag that had not
 *    finished. A rejected creation (a kind this build cannot draw) likewise leaves the tool
 *    held and the board unchanged.
 */

import { useCallback, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type { Doc } from 'yjs';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { useUndoController } from '../board/useUndo';
import { shapeRectFromDrag, shapeRequestFromDrag, createShape, type ShapeKind } from '../../shared/objects/shape';

export interface ShapeToolProps {
  doc: Doc;
  /** Rectangle, ellipse or diamond: whatever the palette's kind menu last chose. */
  kind: ShapeKind;
  camera: Camera;
  /** False while the board cannot be written to (story 4). The tool is not offered then. */
  canEdit?: boolean;
  /** The shape was made: select it and put the pointer back to Select. */
  onCreated(id: string): void;
}

/** The drag, in screen points, as the pointer is making it. */
interface Drag {
  from: Point;
  to: Point;
  square: boolean;
}

/** The dashed outline of the kind being drawn, in screen space. */
function previewShape(kind: ShapeKind, width: number, height: number): JSX.Element {
  const inset = 1; // the dashed stroke itself, so the dashes are not cut off by the box
  if (kind === 'ellipse') {
    return (
      <ellipse
        data-vidi6="shape-preview-outline"
        data-kind={kind}
        cx={width / 2}
        cy={height / 2}
        rx={Math.max(width / 2 - inset, 0)}
        ry={Math.max(height / 2 - inset, 0)}
      />
    );
  }
  if (kind === 'diamond') {
    return (
      <polygon
        data-vidi6="shape-preview-outline"
        data-kind={kind}
        points={`${width / 2},${inset} ${width - inset},${height / 2} ${width / 2},${height - inset} ${inset},${height / 2}`}
      />
    );
  }
  return (
    <rect
      data-vidi6="shape-preview-outline"
      data-kind={kind}
      x={inset}
      y={inset}
      width={Math.max(width - inset * 2, 0)}
      height={Math.max(height - inset * 2, 0)}
    />
  );
}

export function ShapeTool(props: ShapeToolProps): JSX.Element {
  const [drag, setDrag] = useState<Drag | null>(null);

  // The handlers are created once and read the current values through refs, so a drag that
  // outlives a re-render (the camera moved, the palette changed) still uses the real ones.
  const cameraRef = useRef(props.camera);
  cameraRef.current = props.camera;
  const docRef = useRef(props.doc);
  docRef.current = props.doc;
  const kindRef = useRef(props.kind);
  kindRef.current = props.kind;
  const canEditRef = useRef(props.canEdit !== false);
  canEditRef.current = props.canEdit !== false;
  const onCreatedRef = useRef(props.onCreated);
  onCreatedRef.current = props.onCreated;

  const undoController = useUndoController();
  const undoRef = useRef(undoController);
  undoRef.current = undoController;

  // The same drag as the state above, readable from a handler registered once. The state is
  // what renders the preview; the ref is what the release reads, so a single gesture cannot
  // create a shape from a stale closure.
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  /** A point on this surface, in the viewport's own coordinates. */
  const localPoint = (event: ReactPointerEvent<HTMLElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !canEditRef.current) return;
    // The tool holds the pointer for the whole gesture: moving outside this surface, or over
    // an object, keeps drawing rather than dropping the drag.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.stopPropagation();
    const point = localPoint(event);
    setDrag({ from: point, to: point, square: event.shiftKey });
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // Read from the event here, not inside the updater: React releases `currentTarget` when the
    // handler returns, and the updater runs later, during the render.
    const point = localPoint(event);
    // Shift is read on every move, so pressing or releasing it mid-drag changes the shape under
    // the pointer rather than only the one that arrives.
    const square = event.shiftKey;
    setDrag((current) => (current ? { ...current, to: point, square } : current));
  }, []);

  const finish = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!current || !canEditRef.current) return;

    const from = screenToWorld(cameraRef.current, current.from);
    const to = screenToWorld(cameraRef.current, current.to);
    const request = shapeRequestFromDrag({ from, to, square: current.square });
    // One undo step for the shape, bounded on both sides so the typing that may follow the
    // label's double-click is a separate step from the shape it is typed into (`undo.steps`).
    undoRef.current?.boundary();
    const id = createShape(
      docRef.current,
      { kind: kindRef.current, rect: request.rect, at: request.at, square: current.square },
      // Story 6 (names and cursors) is not in this build, so there is no identity to record.
      ''
    );
    undoRef.current?.boundary();
    // A creation the model refused leaves nothing on the board and the tool still held.
    if (id) onCreatedRef.current(id);
  }, []);

  const cancel = useCallback(() => {
    dragRef.current = null;
    setDrag(null);
  }, []);

  // Nothing is drawn until the pointer is down: an idle tool must not put an element between
  // the board and every other control.
  if (!drag) {
    return (
      <div
        className="vidi6-shape-tool"
        data-vidi6="shape-tool"
        data-kind={props.kind}
        data-dragging="false"
        aria-hidden="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finish}
        onPointerCancel={cancel}
      />
    );
  }

  const world = shapeRectFromDrag({ from: screenToWorld(cameraRef.current, drag.from), to: screenToWorld(cameraRef.current, drag.to), square: drag.square });
  const topLeft = worldToScreen(cameraRef.current, { x: world.x, y: world.y });
  const bottomRight = worldToScreen(cameraRef.current, { x: world.x + world.width, y: world.y + world.height });
  const width = Math.max(bottomRight.x - topLeft.x, 0);
  const height = Math.max(bottomRight.y - topLeft.y, 0);

  return (
    <div
      className="vidi6-shape-tool"
      data-vidi6="shape-tool"
      data-kind={props.kind}
      data-dragging="true"
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={cancel}
    >
      <svg
        className="vidi6-shape-preview"
        data-vidi6="shape-preview"
        data-testid="shape-preview"
        style={{ left: topLeft.x, top: topLeft.y, width, height }}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        {previewShape(props.kind, width, height)}
      </svg>
    </div>
  );
}
