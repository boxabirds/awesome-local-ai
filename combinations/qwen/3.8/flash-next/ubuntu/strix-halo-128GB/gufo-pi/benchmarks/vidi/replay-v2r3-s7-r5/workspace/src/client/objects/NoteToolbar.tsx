import React from 'react';
import type { StickyColor } from '../../shared/config';
import { STICKY_COLORS, STICKY_COLOR_NAMES } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const SWATCH_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

/**
 * Floating toolbar of the selected note: six colour swatches and a bin button.
 * Names are exposed through the accessible label and the tooltip so the
 * swatches are not distinguished by colour alone.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  return (
    <div
      data-testid="note-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 4,
        boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {SWATCH_ORDER.map((name) => {
        const label = `${STICKY_COLOR_NAMES[name]} colour`;
        return (
          <button
            key={name}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={name === color}
            data-testid={`swatch-${name}`}
            onClick={() => onColor(name)}
            style={{
              width: 18,
              height: 18,
              padding: 0,
              border: name === color ? '2px solid #455A64' : '1px solid rgba(0,0,0,0.25)',
              borderRadius: 4,
              backgroundColor: STICKY_COLORS[name],
              cursor: 'pointer',
            }}
          />
        );
      })}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        data-testid="delete-note-button"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          padding: 0,
          border: 'none',
          borderRadius: 6,
          background: 'none',
          color: '#5f6368',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3 4h10M6.5 4V2.8h3V4M4.4 4l.6 9.2h6L11.6 4M6.6 6.2v5M9.4 6.2v5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
