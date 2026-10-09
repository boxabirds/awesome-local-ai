import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, JSX } from 'react';
import type { Point, Rect } from '../../shared/geometry';
import type { ShapeKind } from '../../shared/config';
import { DRAG_THRESHOLD_PX } from '../../shared/config';

export interface ShapeToolProps {
  shapeKind: ShapeKind;
  screenToWorld(clientX: number, clientY: number): Point;
  // rect is null for a click or a below-threshold drag; `at` is the start point.
  onCreate(rect: Rect | null, at: Point, square: boolean): void;
  onCancel?(): void;
}

interface DragState {
  startX: number;
  startY: number;
  x: number;
  y: number;
  shift: boolean;
  moved: boolean;
}

// Story 10 Shape tool (design shape.tool): a screen-space overlay that captures
// the pointer (so a drag starting over an existing object never moves it) and
// draws a dashed preview, creating one shape on release.
export function ShapeTool(props: ShapeToolProps): JSX.Element {
  const [drag, setDrag] = useState<DragState | null>(null);
  const pointerId = useRef<number | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    pointerId.current = event.pointerId;
    try {
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    } catch {
      // jsdom and older browsers: window-level pointer events still drive the drag.
    }
    setDrag({ startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, shift: event.shiftKey, moved: false });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    setDrag((prev) => {
      if (prev === null) return prev;
      const moved = prev.moved || Math.hypot(event.clientX - prev.startX, event.clientY - prev.startY) >= DRAG_THRESHOLD_PX;
      return { ...prev, x: event.clientX, y: event.clientY, shift: event.shiftKey, moved };
    });
  };

  const finish = (cancelled: boolean) => (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag === null) return;
    pointerId.current = null;
    if (cancelled) {
      setDrag(null);
      props.onCancel?.();
      return;
    }
    const at = props.screenToWorld(event.clientX, event.clientY);
    if (!drag.moved) {
      props.onCreate(null, at, drag.shift);
    } else {
      const start = props.screenToWorld(drag.startX, drag.startY);
      const rect: Rect = {
        x: Math.min(start.x, at.x),
        y: Math.min(start.y, at.y),
        width: Math.abs(at.x - start.x),
        height: Math.abs(at.y - start.y)
      };
      props.onCreate(rect, at, drag.shift);
    }
    setDrag(null);
  };

  const preview =
    drag !== null
      ? {
          left: Math.min(drag.startX, drag.x),
          top: Math.min(drag.startY, drag.y),
          width: Math.abs(drag.x - drag.startX),
          height: Math.abs(drag.y - drag.startY)
        }
      : null;

  return (
    <div
      data-testid="shape-tool-overlay"
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 45 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish(false)}
      onPointerCancel={finish(true)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {preview !== null ? (
        <div
          data-testid="shape-preview"
          data-kind={props.shapeKind}
          style={{
            position: 'fixed',
            left: preview.left,
            top: preview.top,
            width: preview.width,
            height: preview.height,
            border: '1px dashed #1E88E5',
            background: 'rgba(30,136,229,0.08)',
            boxSizing: 'border-box',
            pointerEvents: 'none'
          }}
        />
      ) : null}
    </div>
  );
}
