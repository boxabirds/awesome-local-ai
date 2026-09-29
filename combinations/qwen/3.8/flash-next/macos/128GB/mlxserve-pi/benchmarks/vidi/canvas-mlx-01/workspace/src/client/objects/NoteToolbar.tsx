import type { JSX, PointerEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config.js';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

/** Capitalised accessible name for a colour key (`pink` -> `Pink`). */
const colourName = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);

/**
 * The floating toolbar shown above the selected sticky note.
 *
 * Six colour swatches (each with an accessible colour name, so they are distinguishable
 * by name and not only by hue) plus a delete button. The current colour's swatch reports
 * `aria-pressed="true"`. Pointer events are stopped so a click here never reaches the
 * board behind it (which would clear the selection).
 */
export function NoteToolbar(props: NoteToolbarProps): JSX.Element {
  const stop = (event: PointerEvent): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="vidi-note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note tools"
      onPointerDown={stop}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((key) => (
        <button
          key={key}
          type="button"
          className="vidi-swatch"
          data-testid={`swatch-${key}`}
          data-color={key}
          aria-label={`${colourName(key)} colour`}
          aria-pressed={props.color === key}
          style={{ background: STICKY_COLORS[key] }}
          onClick={() => {
            props.onColor(key);
          }}
        />
      ))}
      <button
        type="button"
        className="vidi-note-delete"
        data-testid="note-delete"
        aria-label="Delete note"
        onClick={props.onDelete}
      >
        &times;
      </button>
    </div>
  );
}
