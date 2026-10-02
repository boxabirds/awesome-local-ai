import type { CSSProperties } from 'react';

import { STICKY_COLORS, type StickyColor } from '../../shared/config';

/** Colour order as the user reads it left to right on the toolbar. */
export const STICKY_COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

/** Accessible name of a swatch: the colour is named, not only shown. */
export const colorLabel = (color: StickyColor): string =>
  `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;

export interface NoteToolbarProps {
  /** Colour the note has now, so its swatch reads as pressed. */
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/**
 * The floating toolbar of the selected note: six colours and a bin.
 *
 * It belongs to the note but must stay the same size on screen at any zoom, so
 * the note counter-scales it (`sticky.color`, `sticky.delete`). Clicks here are
 * for the toolbar alone: pointer and double-click events stop, otherwise they
 * would reach the board and clear the selection or start editing.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  const stop = (event: { stopPropagation(): void }): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Sticky note tools"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      {STICKY_COLOR_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="sticky-swatch"
          data-testid={`swatch-${name}`}
          data-color={name}
          aria-label={colorLabel(name)}
          title={colorLabel(name)}
          aria-pressed={color === name}
          style={{ backgroundColor: STICKY_COLORS[name] } as CSSProperties}
          onClick={() => onColor(name)}
        />
      ))}
      <button
        type="button"
        className="sticky-delete"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        <span aria-hidden="true">🗑</span>
      </button>
    </div>
  );
}
