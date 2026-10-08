import { useEffect, useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, type ShapeKind } from '../../shared/config';
import { createShape } from '../../shared/objects/shape';
import { normalizeRect } from '../../shared/geometry';
import type { Rect } from '../../shared/geometry';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';

export interface ShapeToolProps {
  /** Which shape the next drag or click draws (the Shape menu's choice). */
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  /** Recorded as the shape's author (PRD shape.create_drag). */
  createdBy: string;
  /** The shape was created: it gets selected and the tool goes back to Select. */
  onCreated(id: string): void;
}

/** A drag in screen space, squared while Shift is held. */
function previewRect(start: Point, end: Point, square: boolean): Rect {
  const raw = normalizeRect(start, end);
  if (!square) return raw;
  // Shift: the larger dimension on both sides, anchored at the corner the drag
  // started from, which is what the person is holding (PRD shape.constrain).
  const side = Math.max(raw.width, raw.height);
  const x = end.x >= start.x ? start.x : start.x - side;
  const y = end.y >= start.y ? start.y : start.y - side;
  return { x, y, width: side, height: side };
}

/**
 * The Shape tool's own surface (PRD shape.create_drag, shape.create_click).
 *
 * It covers the board while the tool is active, so the pointer belongs to the tool:
 * a drag that starts on top of an existing note moves nothing, and the click or drag
 * that makes the shape cannot also select or pan underneath it (TC-28). The preview
 * is drawn in screen space and the shape is created in world space from the same two
 * points, so what was drawn is what lands.
 */
export function ShapeTool({ kind, camera, doc, createdBy, onCreated }: ShapeToolProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
  const pressRef = useRef<Point | null>(null);
  // Latest values for the listeners, which are attached once per gesture surface.
  const live = useRef({ kind, camera, doc, createdBy, onCreated });
  live.current = { kind, camera, doc, createdBy, onCreated };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const toPoint = (e: { clientX: number; clientY: number }): Point => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      // The tool owns the pointer: nothing under the board is moved by this drag.
      e.preventDefault();
      const p = toPoint(e);
      pressRef.current = p;
      setPreview(previewRect(p, p, e.shiftKey));
    };

    const onPointerMove = (e: PointerEvent): void => {
      const press = pressRef.current;
      if (!press) return;
      // Shift can be pressed or released mid-drag, so it is read every move.
      setPreview(previewRect(press, toPoint(e), e.shiftKey));
    };

    const onPointerUp = (e: PointerEvent): void => {
      const press = pressRef.current;
      if (!press) return;
      pressRef.current = null;
      const end = toPoint(e);
      // Both points and the squared preview are converted, so the shape that lands is
      // the one that was drawn, at any zoom (TC-23 measures exactly this).
      const screen = previewRect(press, end, e.shiftKey);
      setPreview(null);
      const camera = live.current.camera;
      const corner = screenToWorld(camera, { x: screen.x, y: screen.y });
      const opposite = screenToWorld(camera, {
        x: screen.x + screen.width,
        y: screen.y + screen.height,
      });
      const world = normalizeRect(corner, opposite);
      // A press that never moved is a click: the model drops a standard shape there.
      const isClick = Math.hypot(end.x - press.x, end.y - press.y) < DRAG_THRESHOLD_PX;
      const id = createShape(
        live.current.doc,
        {
          kind: live.current.kind,
          rect: isClick ? null : world,
          at: { x: world.x + world.width / 2, y: world.y + world.height / 2 },
          square: e.shiftKey,
        },
        live.current.createdBy,
      );
      if (id) live.current.onCreated(id);
      // A rejected creation leaves the tool where it was, with nothing on the board.
    };

    const onPointerCancel = (): void => {
      pressRef.current = null;
      setPreview(null);
    };

    el.addEventListener('pointerdown', onPointerDown);
    // Move and release are tracked on the window, as everywhere else on this board,
    // so a pointer that wanders off the board still finishes the gesture.
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="shape-tool-layer"
      data-testid="shape-tool"
      data-shape-kind={kind}
      aria-label="Shape tool"
    >
      <svg className="shape-tool-svg" data-testid="shape-preview-layer" aria-hidden="true">
        {preview ? <ShapePreview kind={kind} rect={preview} /> : null}
      </svg>
    </div>
  );
}

/** The dashed outline of the shape being drawn, in screen pixels (PRD shape.create_drag). */
export function ShapePreview({ kind, rect }: { kind: ShapeKind; rect: Rect }): JSX.Element {
  const common = {
    'data-testid': 'shape-preview',
    fill: 'none',
    stroke: '#1a73e8',
    strokeWidth: 1,
    strokeDasharray: '4 3',
  } as const;
  if (kind === 'ellipse') {
    return (
      <ellipse
        {...common}
        cx={rect.x + rect.width / 2}
        cy={rect.y + rect.height / 2}
        rx={rect.width / 2}
        ry={rect.height / 2}
      />
    );
  }
  if (kind === 'diamond') {
    const points = [
      `${rect.x + rect.width / 2},${rect.y}`,
      `${rect.x + rect.width},${rect.y + rect.height / 2}`,
      `${rect.x + rect.width / 2},${rect.y + rect.height}`,
      `${rect.x},${rect.y + rect.height / 2}`,
    ].join(' ');
    return <polygon {...common} points={points} />;
  }
  return (
    <rect
      {...common}
      x={rect.x}
      y={rect.y}
      width={Math.max(rect.width, 0)}
      height={Math.max(rect.height, 0)}
    />
  );
}
