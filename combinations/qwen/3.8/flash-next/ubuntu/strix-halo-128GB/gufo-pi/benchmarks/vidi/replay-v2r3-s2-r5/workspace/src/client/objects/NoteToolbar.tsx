import React from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

/** Display names so swatches are distinguishable by name, not only by colour. */
export const STICKY_COLOR_LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

export const STICKY_COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/**
 * Floating toolbar for the selected note: six colour swatches and a delete
 * (bin) button. Rendered unscaled above the note and hidden while dragging or
 * editing.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Note toolbar"
      data-testid="note-toolbar"
      className="vidi6-note-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: '4px 6px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
        width: 'max-content',
      }}
      // Clicks here must never reach the board (which would clear the selection).
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {STICKY_COLOR_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          data-testid={`color-swatch-${name}`}
          data-color={name}
          aria-label={`${STICKY_COLOR_LABELS[name]} colour`}
          aria-pressed={color === name}
          title={`${STICKY_COLOR_LABELS[name]} colour`}
          onClick={() => onColor(name)}
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            padding: 0,
            cursor: 'pointer',
            backgroundColor: STICKY_COLORS[name],
            border: color === name ? '2px solid #1565c0' : '1px solid rgba(0,0,0,0.25)',
            boxShadow: color === name ? '0 0 0 2px rgba(21,101,192,0.25)' : 'none',
          }}
        />
      ))}
      <span aria-hidden="true" style={{ width: 1, height: 18, backgroundColor: '#e0e0e0' }} />
      <button
        type="button"
        data-testid="note-delete-button"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
        style={{
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          padding: '2px 4px',
          color: '#b3261e',
        }}
      >
        🗑
      </button>
    </div>
  );
}
