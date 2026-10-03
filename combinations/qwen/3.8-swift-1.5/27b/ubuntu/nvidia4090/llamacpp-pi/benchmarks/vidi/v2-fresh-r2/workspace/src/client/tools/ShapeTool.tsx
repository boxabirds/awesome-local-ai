/**
 * Shape tool overlay (story 10, shape.tool).
 *
 * Full-screen capture layer while the Shape tool is active:
 * - drag ≥ SHAPE_MIN_SIZE_WORLD → a shape of the dragged size
 * - a click (or a tiny drag) → the standard size centred on the point
 * - Shift → both sides the larger dimension (shape.square)
 * The just-created shape is selected and the tool returns to Select.
 */

import { useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { SHAPE_MIN_SIZE_WORLD, type ShapeKind } from '../../shared/config';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';

interface ShapeToolProps {
  camera: Camera;
  kind: ShapeKind;
  /** Create the shape in the doc; returns the new id or null when rejected. */
  onCreate(a: { kind: ShapeKind; rect: Rect | null; at: Point; square: boolean }): string | null;
  onCreated(id: string): void;
}

interface Draft {
  start: Point;
  current: Point;
  shift: boolean;
}

/** Normalised draft rect (world). */
function draftRect(d: Draft): Rect {
  const x = Math.min(d.start.x, d.current.x);
  const y = Math.min(d.start.y, d.current.y);
  let width = Math.abs(d.current.x - d.start.x);
  let height = Math.abs(d.current.y - d.start.y);
  if (d.shift) {
    const side = Math.max(width, height);
    width = side;
    height = side;
  }
  return { x, y, width, height };
}

export function ShapeTool({ camera, kind, onCreate, onCreated }: ShapeToolProps): JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const toWorld = (e: { clientX: number; clientY: number }): Point =>
    screenToWorld(camera, { x: e.clientX, y: e.clientY });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = toWorld(e);
    setDraft({ start: p, current: p, shift: e.shiftKey });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    setDraft({ ...draft, current: toWorld(e), shift: e.shiftKey });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    const rect = draftRect(draft);
    const isClick = rect.width < SHAPE_MIN_SIZE_WORLD && rect.height < SHAPE_MIN_SIZE_WORLD;
    const at = draft.start;
    const id = onCreate(
      isClick
        ? { kind, rect: null, at, square: false }
        : { kind, rect, at, square: draft.shift },
    );
    setDraft(null);
    if (id) onCreated(id);
  };

  // Draft preview in screen space.
  let preview: { x: number; y: number; w: number; h: number } | null = null;
  if (draft) {
    const r = draftRect(draft);
    const a = { x: (r.x - camera.x) * camera.zoom, y: (r.y - camera.y) * camera.zoom };
    preview = { x: a.x, y: a.y, w: r.width * camera.zoom, h: r.height * camera.zoom };
  }

  return (
    <div
      ref={ref}
      data-testid="shape-tool"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDraft(null)}
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'crosshair',
        zIndex: 5,
        touchAction: 'none',
      }}
    >
      {preview && (
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
          <rect
            x={preview.x}
            y={preview.y}
            width={preview.w}
            height={preview.h}
            fill="rgba(26, 115, 232, 0.08)"
            stroke="#1a73e8"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        </svg>
      )}
    </div>
  );
}
