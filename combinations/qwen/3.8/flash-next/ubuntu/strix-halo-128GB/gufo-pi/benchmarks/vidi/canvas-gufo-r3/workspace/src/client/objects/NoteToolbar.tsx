import React from 'react';
import { STICKY_COLORS, StickyColor } from '@shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

export const NOTE_TOOLBAR_HEIGHT = 32;

/**
 * Floating toolbar for the selected note: six colour swatches and a delete button.
 * Rendered in screen space (does not scale with zoom); hidden while dragging or editing.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  return (
    <div
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note options"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: 'rgba(255,255,255,0.95)',
        borderRadius: '6px',
        padding: '4px 6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        height: `${NOTE_TOOLBAR_HEIGHT}px`,
      }}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => (
        <button
          key={name}
          type="button"
          aria-label={`${COLOR_NAMES[name]} colour`}
          title={`${COLOR_NAMES[name]} colour`}
          aria-pressed={name === color}
          data-testid={`color-swatch-${name}`}
          onClick={() => onColor(name)}
          style={{
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            border: name === color ? '2px solid #1976D2' : '1px solid rgba(0,0,0,0.25)',
            background: STICKY_COLORS[name],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        data-testid="delete-note-button"
        onClick={onDelete}
        style={{
          width: '24px',
          height: '24px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: '2px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.6 9h5.8l.6-9M6.5 6.5v4.5M9.5 6.5v4.5"
            fill="none"
            stroke="#444"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
