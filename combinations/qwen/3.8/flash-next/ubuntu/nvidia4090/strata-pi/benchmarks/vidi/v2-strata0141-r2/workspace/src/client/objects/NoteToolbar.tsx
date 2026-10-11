import { type JSX, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

/**
 * The floating toolbar of the selected note: six colour swatches and a delete
 * (bin) button. Swatches are named, not just coloured, so they are usable by
 * keyboard and screen reader.
 */

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

function colourLabel(color: StickyColor): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation();
  };
  const stopMouse = (event: ReactMouseEvent<HTMLElement>): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      data-vidi6-overlay="true"
      role="toolbar"
      aria-label="Note tools"
      onPointerDown={stop}
      onDoubleClick={stopMouse}
    >
      {COLOR_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          className={`note-swatch note-swatch-${name}`}
          data-testid={`swatch-${name}`}
          style={{ background: STICKY_COLORS[name] }}
          aria-label={colourLabel(name)}
          title={colourLabel(name)}
          aria-pressed={name === color ? 'true' : 'false'}
          onClick={(event) => {
            event.stopPropagation();
            onColor(name);
          }}
        />
      ))}
      <button
        type="button"
        className="note-delete"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 2h4a1 1 0 0 1 1 1v1h3v1.5H2V4h3V3a1 1 0 0 1 1-1Zm-1 5h2v5h2V7h2l-.6 7H5.6L5 7Z"
          />
        </svg>
      </button>
    </div>
  );
}
