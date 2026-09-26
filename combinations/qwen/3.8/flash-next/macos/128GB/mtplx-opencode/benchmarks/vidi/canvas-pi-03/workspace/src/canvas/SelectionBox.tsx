import { useRef, useState } from 'react';
import type { Camera } from '../client/canvas/camera';
import { screenToWorld } from '../client/canvas/camera';
import type { HandleId, Rect } from '../shared/geometry';
import { normalizeRect, resizeRectFromHandle } from '../shared/geometry';

export type { HandleId } from '../shared/geometry';

/**
 * The eight handles offered around a selection. The four corners are always
 * present; the mid-edge handles are what make a wide-but-short cluster
 * resizable at all, so they are not optional.
 */
export const RESIZE_HANDLES: readonly { id: HandleId; label: string; dx: number; dy: number }[] = [
  { id: 'nw', label: 'Resize north-west corner', dx: 0, dy: 0 },
  { id: 'n', label: 'Resize north edge', dx: 0.5, dy: 0 },
  { id: 'ne', label: 'Resize north-east corner', dx: 1, dy: 0 },
  { id: 'e', label: 'Resize east edge', dx: 1, dy: 0.5 },
  { id: 'se', label: 'Resize south-east corner', dx: 1, dy: 1 },
  { id: 's', label: 'Resize south edge', dx: 0.5, dy: 1 },
  { id: 'sw', label: 'Resize south-west corner', dx: 0, dy: 1 },
  { id: 'w', label: 'Resize west edge', dx: 0, dy: 0.5 },
];

const SIZE = 8;

export interface SelectionTransform {
  handle: HandleId;
  /** The box the selection had when the gesture began. */
  from: Rect;
  /** The box it has now. */
  to: Rect;
  /** Shift was held: keep the member aspect ratios. */
  additive: boolean;
}

export interface SelectionBoxProps {
  /** Screen-space bounds of the whole selection; null hides the frame. */
  bounds: { left: number; top: number; width: number; height: number } | null;
  /** The world box the bounds were derived from, so a drag can be mapped back. */
  world?: Rect | null;
  camera?: Camera | null;
  /** `none` renders nothing: the state where a board has no selection at all. */
  mode?: 'frame' | 'none';
  accent?: string;
  resizable?: boolean;
  /** Screen-space rectangle of an in-progress marquee, if any. */
  marquee?: { left: number; top: number; width: number; height: number } | null;
  onTransform?: (t: SelectionTransform) => void;
  onTransformEnd?: () => void;
}

/**
 * The selection's outline and its resize handles.
 *
 * Three things are load-bearing for the product:
 *
 * - The frame is drawn **outside** the objects, so it never hides their
 *   content (TC-33). The handles are offset to sit on the outline.
 * - The frame is a single shape for the whole selection, not one per object:
 *   four notes are one group, and four boxes would read as four separate
 *   choices.
 * - Every handle is a focusable button with a spoken name, because a resize
 *   that only works with a mouse is not available to a keyboard user.
 */
export function SelectionBox({
  bounds,
  world = null,
  camera = null,
  mode = 'frame',
  accent = '#6366f1',
  resizable = true,
  marquee = null,
  onTransform,
  onTransformEnd,
}: SelectionBoxProps) {
  const [hover, setHover] = useState<HandleId | null>(null);
  const drag = useRef<{ handle: HandleId; from: Rect; base: Rect } | null>(null);

  if (mode === 'none') {
    return marquee ? <Marquee rect={marquee} accent={accent} /> : null;
  }
  if (bounds === null || bounds.width <= 0 || bounds.height <= 0) {
    return marquee ? <Marquee rect={marquee} accent={accent} /> : null;
  }

  const move = (e: React.PointerEvent) => {
    const active = drag.current;
    if (!active || !camera || !world) return;
    const pointer = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const to = resizeRectFromHandle(active.base, active.handle, pointer);
    onTransform?.({ handle: active.handle, from: active.from, to, additive: e.shiftKey });
  };

  return (
    <div
      data-testid="selection-box"
      style={{
        position: 'absolute',
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        border: `1.5px solid ${accent}`,
        borderRadius: 2,
        pointerEvents: 'none',
        zIndex: 3,
      }}
    >
      {marquee ? <Marquee rect={marquee} accent={accent} /> : null}
      {resizable
        ? RESIZE_HANDLES.map((h) => (
            <button
              key={h.id}
              type="button"
              data-testid={`handle-${h.id}`}
              aria-label={h.label}
              title={h.label}
              tabIndex={-1}
              onPointerDown={(e) => {
                if (!world || !camera) return;
                e.stopPropagation();
                e.preventDefault();
                // Keep the drag's pointermove events coming to this handle even
                // once the pointer leaves its 8px box (real browsers deliver
                // them to the captured element; jsdom no-ops the call).
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                drag.current = { handle: h.id, from: world, base: world };
                setHover(h.id);
              }}
              onPointerMove={move}
              onPointerUp={(e) => {
                (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
                if (!drag.current) return;
                drag.current = null;
                setHover(null);
                onTransformEnd?.();
                e.stopPropagation();
              }}
              style={{
                position: 'absolute',
                left: `calc(${h.dx * 100}% - ${SIZE / 2}px)`,
                top: `calc(${h.dy * 100}% - ${SIZE / 2}px)`,
                width: SIZE,
                height: SIZE,
                padding: 0,
                border: `1.5px solid ${accent}`,
                borderRadius: 1,
                background: hover === h.id ? accent : '#ffffff',
                pointerEvents: 'auto',
                cursor: cursorFor(h.id),
              }}
            />
          ))
        : null}
    </div>
  );
}

function Marquee({ rect, accent }: { rect: { left: number; top: number; width: number; height: number }; accent: string }) {
  return (
    <div
      data-testid="marquee"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        border: `1px solid ${accent}`,
        background: 'rgba(99,102,241,0.12)',
        pointerEvents: 'none',
      }}
    />
  );
}

function cursorFor(handle: HandleId): string {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'nw':
    case 'se':
      return 'nwse-resize';
    default:
      return 'nesw-resize';
  }
}

/** Convenience for callers that hold world rects and a camera. */
export function marqueeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect | null {
  const r = normalizeRect(a, b);
  return r.width < 1 && r.height < 1 ? null : r;
}
