/**
 * Story 2 · task 6 — the per-note toolbar (design "Toolbars: create, colour,
 * delete").
 *
 * Rendered for the selected note only, in screen space (it counter-scales with
 * 1/zoom so it never grows with the board) and hidden while dragging or
 * editing. Every button carries an accessible name and, for swatches, an
 * `aria-pressed` state; colours are distinguishable by name, not only by hue
 * (PRD "Accessibility"). Pointer events are stopped so a click here never
 * reaches the board surface and clears the selection.
 */
import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/** Colour names in display order, capitalised for the accessible label. */
const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];
const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  // The toolbar belongs to the note, not the board: a click must not pan the
  // board or clear the selection that this toolbar depends on.
  const stop = (event: { stopPropagation(): void }) => {
    event.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note actions"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      {COLOR_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          className="swatch"
          data-testid={`swatch-${name}`}
          data-color={name}
          aria-label={`${label(name)} colour`}
          aria-pressed={color === name}
          style={{ backgroundColor: STICKY_COLORS[name] }}
          onPointerDown={stop}
          onClick={(event) => {
            event.stopPropagation();
            onColor(name);
          }}
        />
      ))}
      <button
        type="button"
        className="note-delete"
        data-testid="note-delete"
        aria-label="Delete note"
        onPointerDown={stop}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        {'\u{1F5D1}'}
      </button>
    </div>
  );
}