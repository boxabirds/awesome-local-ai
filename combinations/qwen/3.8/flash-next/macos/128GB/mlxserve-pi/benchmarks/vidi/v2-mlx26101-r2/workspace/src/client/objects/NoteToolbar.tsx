import type { JSX } from 'react';

import { STICKY_COLORS, type StickyColor } from '../../shared/config.js';

/**
 * The six colour names, capitalised, for the accessible names and tooltips:
 * a swatch must be identifiable by name, not only by its colour (PRD
 * "Accessibility").
 */
export const STICKY_COLOR_LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

/** The order the swatches appear in the toolbar. */
export const STICKY_COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

export interface NoteToolbarProps {
  /** The selected note's current colour: its swatch is pressed. */
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/**
 * The floating toolbar of the selected note: six colour swatches and a delete
 * (bin) button. Rendered for the selected note only, and not while it is being
 * dragged or edited (the note decides when to show it).
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="group"
      aria-label="Note options"
      // The toolbar belongs to the note, not to the board: a pointerdown here
      // must neither start a note drag nor reach the viewport (which would
      // clear the selection).
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {STICKY_COLOR_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="note-color-swatch"
          data-testid={`sticky-color-${name}`}
          data-color={name}
          aria-label={`${STICKY_COLOR_LABELS[name]} colour`}
          title={STICKY_COLOR_LABELS[name]}
          aria-pressed={name === color}
          style={{ backgroundColor: STICKY_COLORS[name] }}
          onClick={() => onColor(name)}
        />
      ))}
      <button
        type="button"
        className="note-delete"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        🗑
      </button>
    </div>
  );
}
