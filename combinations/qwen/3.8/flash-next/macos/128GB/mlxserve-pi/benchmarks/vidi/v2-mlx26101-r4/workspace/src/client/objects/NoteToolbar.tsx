/**
 * The toolbar that floats above the selected sticky note: the six colours and
 * the bin. It is rendered in screen space (the note counter-scales it), so it
 * stays the same size at every zoom, and it is hidden while the note is being
 * dragged or typed into.
 *
 * A colour must be nameable, not just visible: every swatch carries the colour's
 * name in its accessible name and in its tooltip, so two notes that differ only
 * by colour are still distinguishable without seeing them.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import { STICKY_COLORS } from '../../shared/config';
import type { StickyColor } from '../../shared/config';

/** The order the swatches appear in, which is the order of `STICKY_COLORS`. */
const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** "yellow" reads as "Yellow" in a label and a tooltip. */
function labelOf(color: StickyColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

const DELETE_LABEL = 'Delete note';

export interface NoteToolbarProps {
  /** The note's current colour, which is the swatch that reads as pressed. */
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
  /**
   * Grey the whole thing out: on a board that could not be loaded the note is not
   * yours to change. `App` refuses the write whatever happens here; this is so the
   * note does not offer commands that go nowhere.
   */
  disabled?: boolean;
}

export function NoteToolbar({ color, onColor, onDelete, disabled = false }: NoteToolbarProps): JSX.Element {
  /** A click here is a command, never a board gesture: no pan, no deselect. */
  const stop = (event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Sticky note tools"
      onPointerDown={stop}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      {COLOR_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          className="note-toolbar__swatch"
          data-testid={`color-${name}`}
          data-color={name}
          aria-label={`${labelOf(name)} colour`}
          aria-pressed={color === name}
          title={`${labelOf(name)} colour`}
          style={{ backgroundColor: STICKY_COLORS[name] }}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            onColor(name);
          }}
        />
      ))}
      <button
        type="button"
        className="note-toolbar__delete"
        data-testid="note-delete"
        aria-label={DELETE_LABEL}
        title={DELETE_LABEL}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          onDelete();
        }}
      >
        {/* A bin, drawn with borders rather than an icon font, so it needs no
            asset and no font to look like a bin. */}
        <span className="note-toolbar__bin" aria-hidden="true" />
      </button>
    </div>
  );
}
