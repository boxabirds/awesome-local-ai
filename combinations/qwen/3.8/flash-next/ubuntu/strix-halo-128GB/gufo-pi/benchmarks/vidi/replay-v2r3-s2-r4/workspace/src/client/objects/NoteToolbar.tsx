import React, { useCallback } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as readonly StickyColor[];

function colourLabel(color: StickyColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

/**
 * Floating toolbar for the selected note: six colour swatches and a delete (bin)
 * button. Swatches carry a colour name in their accessible name and tooltip, so
 * they are distinguishable without seeing the colour.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  const stop = useCallback((e: React.SyntheticEvent) => {
    // Clicks here must never reach the viewport (which would clear the selection).
    e.stopPropagation();
  }, []);

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Sticky note options"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      {COLOR_NAMES.map((name) => {
        const label = `${colourLabel(name)} colour`;
        return (
          <button
            key={name}
            type="button"
            className="note-toolbar-swatch"
            data-testid={`swatch-${name}`}
            aria-label={label}
            aria-pressed={name === color}
            title={label}
            style={{ backgroundColor: STICKY_COLORS[name] }}
            onClick={() => onColor(name)}
          />
        );
      })}
      <button
        type="button"
        className="note-toolbar-delete"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        {/* bin glyph */}
        <span aria-hidden="true">&#128465;</span>
      </button>
    </div>
  );
}
