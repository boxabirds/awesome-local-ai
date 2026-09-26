import type { Camera } from '../client/canvas/camera';
import { worldToScreen } from '../client/canvas/camera';

/** Screen-space bounds of a selection, plus the anchor used for HUD placement. */
export function selectionScreenBounds(
  rects: { x: number; y: number; width: number; height: number }[],
  camera: Camera,
): { left: number; top: number; width: number; height: number } | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.width) || !Number.isFinite(r.height)) {
      continue;
    }
    const a = worldToScreen(camera, { x: r.x, y: r.y });
    const b = worldToScreen(camera, { x: r.x + r.width, y: r.y + r.height });
    minX = Math.min(minX, a.x, b.x);
    maxX = Math.max(maxX, a.x, b.x);
    minY = Math.min(minY, a.y, b.y);
    maxY = Math.max(maxY, a.y, b.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

export interface SelectionBarProps {
  /** How many objects the bar stands for. */
  count: number;
  /** Screen-space bounds of the selection, used to place the bar. */
  bounds: { left: number; top: number; width: number; height: number } | null;
  /** True when every member declares itself resizable. */
  resizable: boolean;
  onDelete?(): void;
}

/**
 * The selection's HUD: a frame around the group, eight handles and one delete
 * control that removes the whole selection.
 *
 * It is deliberately a single button, not per-object controls: a learner who
 * has selected four notes wants "remove these four", and a control per object
 * would force them to repeat the action per object. It is also a real
 * `<button>`, so it is reachable by keyboard and announced by a screen reader.
 */
export function SelectionBar({ count, bounds, resizable, onDelete }: SelectionBarProps) {
  if (count === 0 || bounds === null) return null;
  return (
    <div
      data-testid="selection-bar"
      role="group"
      aria-label={`${count} selected`}
      style={{
        position: 'absolute',
        left: bounds.left + bounds.width + 8,
        top: Math.max(0, bounds.top - 4),
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 4px',
        borderRadius: 6,
        background: 'rgba(255,255,255,0.94)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
        zIndex: 4,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 11, color: '#475569' }}>
        {count}
      </span>
      <button
        type="button"
        data-testid="selection-delete"
        aria-label={`Delete ${count} selected`}
        title={`Delete ${count} selected`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onDelete?.()}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: 2,
          lineHeight: 0,
          color: '#dc2626',
        }}
      >
        {/* One glyph, sized for a 28px hit area, so the bar cannot grow past
            the width budget. */}
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            d="M3 4h10M6.5 4V2.8h3V4M5 4l.5 8.2h5L11 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {resizable ? (
        <span data-testid="selection-resize-hint" style={{ fontSize: 11, color: '#64748b' }}>
          drag a handle
        </span>
      ) : null}
    </div>
  );
}
