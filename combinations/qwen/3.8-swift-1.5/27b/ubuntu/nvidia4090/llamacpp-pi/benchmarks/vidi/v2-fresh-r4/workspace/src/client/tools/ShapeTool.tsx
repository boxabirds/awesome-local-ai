/**
 * ShapeTool (story 10): draws a shape of the chosen kind.
 *
 * - Click: creates a standard-size (160x160 world) shape centred on the click.
 * - Drag: creates the shape at the dragged rect.
 * - Shift: width = height = the larger dragged dimension (anchored at the
 *   drag origin).
 * - A drag smaller than the minimum size in either dimension falls back to
 *   the standard size (model-side, TC-02).
 *
 * The tool renders a full-viewport overlay (crosshair) with a dashed
 * screen-space preview while dragging. On release it calls `createShape`
 * (one LOCAL_ORIGIN update) and `onCreated(id)`.
 */
import { useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import type { Point, Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { createShape, type ShapeKind } from '../../shared/objects/shape';
import { LOCAL_USER_ID } from '../../shared/config';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  onCreated(id: string): void;
  canEdit?: boolean;
}

interface DragState {
  startScreen: Point;
  startWorld: Point;
  shift: boolean;
}

/** Normalised (positive w/h) rect between two world points. */
function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Shift-constrained square anchored at `a`, sized by the larger dimension. */
function squareFrom(a: Point, b: Point): Rect {
  const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return {
    x: b.x < a.x ? a.x - side : a.x,
    y: b.y < a.y ? a.y - side : a.y,
    width: side,
    height: side,
  };
}

function rectFor(drag: DragState, curWorld: Point): Rect {
  return drag.shift ? squareFrom(drag.startWorld, curWorld) : rectBetween(drag.startWorld, curWorld);
}

export function ShapeTool(props: ShapeToolProps): JSX.Element {
  const { kind, camera, doc, onCreated, canEdit = true } = props;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const camRef = useRef(camera);
  camRef.current = camera;

  const viewportPoint = (e: React.PointerEvent): Point => ({
    x: e.clientX,
    y: e.clientY,
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canEdit || e.button !== 0) return;
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // jsdom: setPointerCapture may be unavailable
    }
    const p = viewportPoint(e);
    setDrag({ startScreen: p, startWorld: screenToWorld(camRef.current, p), shift: e.shiftKey });
    setCursor(p);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setCursor(viewportPoint(e));
    if (e.shiftKey !== drag.shift) {
      setDrag({ ...drag, shift: e.shiftKey });
    }
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const p = viewportPoint(e);
    const world = screenToWorld(camRef.current, p);
    const isClick = p.x === drag.startScreen.x && p.y === drag.startScreen.y;
    const rect: Rect | null = isClick ? null : rectFor(drag, world);
    const id = createShape(doc, { kind, rect, at: drag.startWorld }, LOCAL_USER_ID);
    setDrag(null);
    setCursor(null);
    if (id) onCreated(id);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    finish(e);
  };

  const handlePointerCancel = () => {
    setDrag(null);
    setCursor(null);
  };

  // Screen-space preview rect while dragging.
  let preview: Rect | null = null;
  if (drag && cursor) {
    const curWorld = screenToWorld(camRef.current, cursor);
    const worldRect = rectFor(drag, curWorld);
    const tl = worldToScreen(camRef.current, { x: worldRect.x, y: worldRect.y });
    preview = {
      x: tl.x,
      y: tl.y,
      width: worldRect.width * camRef.current.zoom,
      height: worldRect.height * camRef.current.zoom,
    };
  }

  return (
    <div
      data-vidi6="shape-tool"
      className="tool-overlay"
      style={{ cursor: 'crosshair' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {preview && preview.width > 0 && preview.height > 0 && (
        <div
          data-vidi6="shape-preview"
          className="shape-preview"
          style={{
            position: 'absolute',
            left: preview.x,
            top: preview.y,
            width: preview.width,
            height: preview.height,
          }}
        />
      )}
    </div>
  );
}
