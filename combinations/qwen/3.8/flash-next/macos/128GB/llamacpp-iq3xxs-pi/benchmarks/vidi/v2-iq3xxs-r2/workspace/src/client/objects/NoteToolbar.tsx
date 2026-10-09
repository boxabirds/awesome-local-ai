import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

/** Toolbar order of the six preset colours (the order of the settings object). */
export const STICKY_COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

/** Colour names are spelled out so a swatch is not identified by colour alone. */
export function stickyColorLabel(color: StickyColor): string {
  return `${color.slice(0, 1).toUpperCase()}${color.slice(1)}`;
}

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/**
 * The floating toolbar above the selected note: six colour swatches and a delete button.
 * It is rendered in screen space (it does not scale with zoom) and is hidden while the
 * note is being dragged or edited.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // A click on a swatch must not reach the viewport, which would clear the selection.
    event.stopPropagation();
  };

  return (
    <div
      className="vidi6-note-toolbar"
      data-testid="note-toolbar"
      role="group"
      aria-label="Note options"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={stop}
    >
      {STICKY_COLOR_ORDER.map((option) => {
        const label = `${stickyColorLabel(option)} colour`;
        return (
          <button
            key={option}
            type="button"
            className="vidi6-swatch"
            data-testid={`swatch-${option}`}
            data-color={option}
            style={{ backgroundColor: STICKY_COLORS[option] }}
            aria-label={label}
            aria-pressed={color === option}
            title={label}
            onClick={() => {
              onColor(option);
            }}
          />
        );
      })}
      <button
        type="button"
        className="vidi6-delete-note"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6.5 1.5h3l.5 1.5h2.5v1.5h-1l-.7 8.2A1.5 1.5 0 0 1 10.3 14H5.7a1.5 1.5 0 0 1-1.5-1.3L3.5 4.5H2.5V3h3.5l.5-1.5Zm-.6 3h1v6h-1v-6Zm2.6 0h1v6h-1v-6Z"
          />
        </svg>
      </button>
    </div>
  );
}
