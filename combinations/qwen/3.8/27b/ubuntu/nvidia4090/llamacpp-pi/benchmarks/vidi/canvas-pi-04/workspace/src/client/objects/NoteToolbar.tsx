// Story 2: the floating toolbar for a selected sticky note (anchor:
// sticky.toolbar): six colour swatches and a delete button, positioned above
// the note in screen space (counter-scaled by the parent).

import type { JSX } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

function colorLabel(color: StickyColor): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

export function NoteToolbar(props: {
  color: StickyColor;
  onColor: (color: StickyColor) => void;
  onDelete: () => void;
  /** When true (board load_failed) the tools are inert. */
  disabled?: boolean;
}): JSX.Element {
  const disabled = props.disabled === true;
  const stop = (e: ReactPointerEvent | ReactMouseEvent): void => {
    e.stopPropagation();
  };
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Note tools"
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={stop}
    >
      {COLOR_NAMES.map((color) => (
        <button
          key={color}
          type="button"
          className="note-toolbar__swatch"
          title={colorLabel(color)}
          aria-label={colorLabel(color)}
          aria-pressed={props.color === color}
          disabled={disabled}
          style={{ background: STICKY_COLORS[color] }}
          onClick={() => props.onColor(color)}
        />
      ))}
      <button
        type="button"
        className="note-toolbar__delete"
        title="Delete note"
        aria-label="Delete note"
        disabled={disabled}
        onClick={props.onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M5 2V1h6v1h4v1.5H1V2h4zm-1 3.5h8l-.6 8.2a1 1 0 0 1-1 .98H4.6a1 1 0 0 1-1-.98L4 5.5zm2.2 1.4.35 6.1h.95l.2-6.1H6.2zm2.3 0 .2 6.1h.95l.35-6.1h-1.5z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}
