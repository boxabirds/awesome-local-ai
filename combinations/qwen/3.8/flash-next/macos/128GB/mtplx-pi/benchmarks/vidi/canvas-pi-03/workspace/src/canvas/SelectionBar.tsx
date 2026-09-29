import { useState } from 'react';
import type { Camera } from '../client/canvas/camera';
import { worldToScreen } from '../client/canvas/camera';
import { TextToolbar } from '../client/objects/TextToolbar';
import type { TextSize } from '../shared/config';

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
  /** True when the selection may have its size typed in: one object, free
   * resize in both axes. A cluster gets the handles and the bin only. */
  sized?: boolean;
  /** Current size of the selection in world units; a non-finite or empty one
   * shows a placeholder instead of a value. */
  size?: { width: number; height: number } | null;
  onDelete?(): void;
  /** A committed size field (Enter or blur). */
  onSize?: (next: { width: number; height: number }) => void;
  /** The size stepper, for a selection of exactly one text block. */
  text?: { size: TextSize; onSize(size: TextSize): void } | null;
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
export function SelectionBar({
  count,
  bounds,
  resizable,
  sized = false,
  size = null,
  onDelete,
  onSize,
  text = null,
}: SelectionBarProps) {
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
      {text !== null ? <TextToolbar size={text.size} onSize={text.onSize} /> : null}
      {sized && size !== null && onSize !== undefined ? (
        <SizeFields
          size={size}
          onCommit={(next) => {
            onSize?.(next);
          }}
        />
      ) : null}
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

/**
 * W/H fields for one free-resize object: the box's current size, step 4,
 * committed by Enter or blur. An unparsable or non-positive entry is dropped —
 * the object keeps its last valid size rather than snapping to something the
 * user never typed.
 */
function SizeFields({
  size,
  onCommit,
}: {
  size: { width: number; height: number };
  onCommit: (next: { width: number; height: number }) => void;
}) {
  const shown = (value: number) => (Number.isFinite(value) && value > 0 ? String(Math.round(value)) : '');
  const [width, setWidth] = useState(shown(size.width));
  const [height, setHeight] = useState(shown(size.height));
  const [editing, setEditing] = useState<'width' | 'height' | null>(null);

  // A new selection (or a finished drag) repopulates the fields, so they show
  // the object's real size and never the remnant of the previous one.
  const key = `${Math.round(size.width)}x${Math.round(size.height)}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setEditing(null);
    setWidth(shown(size.width));
    setHeight(shown(size.height));
  }

  const commit = () => {
    setEditing(null);
    const w = Number.parseFloat(width);
    const h = Number.parseFloat(height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      // Invalid entry: put the real size back instead of resizing to garbage.
      setWidth(shown(size.width));
      setHeight(shown(size.height));
      return;
    }
    onCommit({ width: w, height: h });
  };

  const field = (
    testid: string,
    label: string,
    value: string,
    setValue: (v: string) => void,
  ) => (
    <input
      type="number"
      data-testid={testid}
      aria-label={label}
      title={label}
      step={4}
      value={value}
      placeholder="—"
      onPointerDown={(e) => e.stopPropagation()}
      onFocus={() => setEditing(label.toLowerCase() === 'width' ? 'width' : 'height')}
      onChange={(e) => {
        setValue(e.target.value);
        setEditing(label.toLowerCase() === 'width' ? 'width' : 'height');
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') setEditing(null);
        e.stopPropagation();
      }}
      onBlur={commit}
      style={{ width: 46, fontSize: 11, padding: '2px 4px', border: '1px solid #cbd5e1', borderRadius: 4 }}
    />
  );

  return (
    <>
      {field('sel-width', 'Width', editing === 'height' ? height : width, editing === 'height' ? setHeight : setWidth)}
      {field('sel-height', 'Height', editing === 'width' ? width : height, editing === 'width' ? setWidth : setHeight)}
    </>
  );
}
