import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { createShape } from '../../shared/objects/shape';
import type { ShapeKind } from '../../shared/config';
import { normalizeRect, type Rect } from '../../shared/geometry';
import type { Camera, Point } from '../canvas/camera';
import { clientToWorld } from '../canvas/viewportPoint';
import { useBoardDoc } from '../board/useBoardDoc';
import { useIdentity } from '../board/useIdentity';
import { useUndoController } from '../board/UndoContext';
import { SHAPE_KIND_LABEL } from '../objects/ShapeObject';

/** A drag in progress, in client (screen) coordinates. */
interface Drag {
  startX: number;
  startY: number;
  x: number;
  y: number;
  square: boolean;
}

/** Screen-space rectangle of a drag, Shift-squared when asked. */
function previewRect(drag: Drag): Rect {
  const dx = drag.x - drag.startX;
  const dy = drag.y - drag.startY;
  if (!drag.square) return normalizeRect({ x: drag.startX, y: drag.startY }, { x: drag.x, y: drag.y });
  // Shift: both sides become the larger dragged dimension, anchored at the
  // corner the drag started from (`shape.constrain`).
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  const x1 = dx < 0 ? drag.startX - side : drag.startX;
  const y1 = dy < 0 ? drag.startY - side : drag.startY;
  return { x: x1, y: y1, width: side, height: side };
}

export interface ShapeToolProps {
  /** Which kind of shape the tool draws right now. */
  kind: ShapeKind;
  camera: Camera;
  /** A shape was created: select it and return to Select. */
  onCreated(id: string): void;
}

/**
 * The Shape tool (story 10, `shape.create_drag`, `shape.create_click`): a
 * capture layer over the board that turns a drag into a shape covering exactly
 * the dragged area, and a click (or a drag too small to be a drag) into a
 * standard-size shape centred on the point.
 *
 * The layer owns every pointer gesture while the tool is active, so pressing on
 * an existing shape draws a new one over it instead of moving it. Shift is read
 * on every move, so pressing or releasing it mid-drag constrains at once.
 */
export function ShapeTool({ kind, camera, onCreated }: ShapeToolProps): JSX.Element {
  const { doc } = useBoardDoc();
  const identity = useIdentity();
  const undo = useUndoController();
  const [drag, setDrag] = useState<Drag | null>(null);
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  });

  const create = useCallback(
    (start: Point, end: Point, square: boolean) => {
      const worldStart = clientToWorld(cameraRef.current, start);
      const worldEnd = clientToWorld(cameraRef.current, end);
      if (!Number.isFinite(worldStart.x) || !Number.isFinite(worldStart.y)) return;
      undo?.boundary();
      const id = createShape(
        doc,
        { kind, rect: normalizeRect(worldStart, worldEnd), at: worldStart, square },
        identity.id,
      );
      undo?.boundary();
      if (id !== null) onCreated(id);
    },
    [doc, identity.id, kind, onCreated, undo],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    setDrag({
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      square: event.shiftKey,
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    setDrag((current) =>
      current === null
        ? current
        : { ...current, x: event.clientX, y: event.clientY, square: event.shiftKey },
    );
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag;
    setDrag(null);
    if (current === null) return;
    event.stopPropagation();
    create(
      { x: current.startX, y: current.startY },
      { x: event.clientX, y: event.clientY },
      event.shiftKey || current.square,
    );
  };

  const preview = drag === null ? null : previewRect(drag);

  return (
    <div
      data-testid="shape-tool-layer"
      className="tool-layer"
      style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onDoubleClick={(event) => {
        // A double-click while the Shape tool is active must not create a note.
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      {preview !== null && (
        <div
          data-testid="shape-preview"
          data-kind={kind}
          aria-label={`Draw ${SHAPE_KIND_LABEL[kind]}`}
          style={{
            position: 'fixed',
            left: `${preview.x}px`,
            top: `${preview.y}px`,
            width: `${preview.width}px`,
            height: `${preview.height}px`,
            border: '1px dashed #2563EB',
            background: 'rgba(59, 130, 246, 0.12)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
