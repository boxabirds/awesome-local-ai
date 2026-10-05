import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

import { STICKY_COLORS, type StickyColor } from '../../shared/config';

/** Accessible / tooltip names for the six preset colours. */
export const STICKY_COLOR_LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

/** The six swatch names in toolbar order (the order of `STICKY_COLORS`). */
export const STICKY_COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

export interface NoteToolbarProps {
  /** The selected note's colour: its swatch is the pressed one. */
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/**
 * The floating toolbar of the selected note: six colour swatches and a delete
 * (bin) button. It is rendered inside the note and counter-scaled by
 * `--inv-zoom`, so it stays a constant screen size at any zoom level. Pointer
 * events are swallowed here so a click on a swatch never reaches the board
 * (which would pan it or clear the selection).
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): React.JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement> | ReactWheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };
  return (
    <div
      aria-label="Note toolbar"
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      onClick={stop}
      onDoubleClick={stop}
      onPointerCancel={stop}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onWheel={stop}
    >
      {STICKY_COLOR_NAMES.map((name) => (
        <button
          key={name}
          aria-label={`${STICKY_COLOR_LABELS[name]} colour`}
          aria-pressed={name === color}
          className={`note-swatch note-swatch-${name}`}
          data-testid={`color-${name}`}
          style={{ background: STICKY_COLORS[name] }}
          title={STICKY_COLOR_LABELS[name]}
          type="button"
          onClick={() => {
            onColor(name);
          }}
        />
      ))}
      <button
        aria-label="Delete note"
        className="note-delete"
        data-testid="delete-note"
        title="Delete note"
        type="button"
        onClick={onDelete}
      >
        <span aria-hidden="true">🗑</span>
      </button>
    </div>
  );
}
