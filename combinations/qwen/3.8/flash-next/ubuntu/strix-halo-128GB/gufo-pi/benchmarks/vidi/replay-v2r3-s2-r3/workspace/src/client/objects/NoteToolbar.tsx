import React from 'react';
import { STICKY_COLORS } from '../../shared/config';
import type { StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Accessible / tooltip name for a colour, e.g. "Pink colour" (not colour alone). */
export function stickyColorLabel(color: StickyColor): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

const SWATCH_SIZE = 22;

/**
 * Floating toolbar for the selected note: six colour swatches and a delete (bin)
 * button. Rendered in screen space above the note (it is counter-scaled by the
 * caller, so it does not grow with board zoom) and hidden while dragging or
 * editing. Clicks never reach the viewport, so they cannot clear the selection.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  const stop = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Sticky note tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onDoubleClick={stop}
      onWheel={stop}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 6px',
        backgroundColor: '#ffffff',
        borderRadius: 8,
        boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
        whiteSpace: 'nowrap',
      }}
    >
      {COLOR_NAMES.map((name) => {
        const pressed = name === color;
        const label = stickyColorLabel(name);
        return (
          <button
            key={name}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={pressed}
            data-testid={`swatch-${name}`}
            onClick={() => onColor(name)}
            style={{
              width: SWATCH_SIZE,
              height: SWATCH_SIZE,
              padding: 0,
              borderRadius: '50%',
              backgroundColor: STICKY_COLORS[name],
              border: pressed ? '2px solid #1976d2' : '1px solid rgba(0,0,0,0.25)',
              cursor: 'pointer',
              display: 'inline-block',
            }}
          />
        );
      })}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        data-testid="delete-note"
        onClick={onDelete}
        style={{
          marginLeft: 2,
          width: SWATCH_SIZE + 4,
          height: SWATCH_SIZE + 4,
          padding: 0,
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#b3261e',
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <title>Delete note</title>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </button>
    </div>
  );
}
