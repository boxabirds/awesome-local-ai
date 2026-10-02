import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

function displayName(color: StickyColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

const swatchBase: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 4,
  border: '1px solid rgba(0,0,0,0.25)',
  padding: 0,
  cursor: 'pointer',
  display: 'inline-block',
};

/**
 * Floating toolbar shown above the currently selected note (hidden while it is
 * being dragged or edited). Six named colour swatches — each distinguishable by
 * an accessible name and tooltip, not only by its colour — plus a delete (bin)
 * button. Pointer events are stopped so interacting with the toolbar never pans
 * the board, clears the selection or starts a note drag.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  const stop = (e: ReactPointerEvent) => e.stopPropagation();
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note actions"
      onPointerDown={stop}
      style={{
        position: 'absolute',
        left: 0,
        top: -44,
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        background: '#fff',
        border: '1px solid #e2e4ea',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
      }}
    >
      {ORDER.map((name) => {
        const pressed = name === color;
        return (
          <button
            key={name}
            type="button"
            aria-label={`${displayName(name)} colour`}
            title={`${displayName(name)} colour`}
            aria-pressed={pressed}
            onClick={() => onColor(name)}
            style={{
              ...swatchBase,
              background: STICKY_COLORS[name],
              outline: pressed ? '2px solid #1b1d23' : 'none',
            }}
          />
        );
      })}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
        style={{
          marginLeft: 2,
          border: '1px solid #d0d3da',
          background: '#fff',
          borderRadius: 4,
          height: 20,
          cursor: 'pointer',
          fontSize: 13,
          lineHeight: 1,
          padding: '0 6px',
        }}
      >
        🗑
      </button>
    </div>
  );
}
