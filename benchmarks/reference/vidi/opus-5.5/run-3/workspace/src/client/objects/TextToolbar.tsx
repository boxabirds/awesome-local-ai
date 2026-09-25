import type { SyntheticEvent } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

const SIZES = Object.keys(TEXT_SIZES) as TextSize[];

export function sizeLabel(s: TextSize): string {
  return `Size ${s}`;
}

// Keep pointer and double-click events away from the text (drag, edit) and the board (deselect, create).
const stop = (e: SyntheticEvent) => e.stopPropagation();

/** Size presets and delete button for the one selected text object. */
export function TextToolbar(props: { size: TextSize; onSize(s: TextSize): void; onDelete(): void }) {
  return (
    <div
      className="note-toolbar text-toolbar"
      role="toolbar"
      aria-label="Text"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          className="text-toolbar__size"
          aria-label={sizeLabel(s)}
          aria-pressed={props.size === s}
          title={sizeLabel(s)}
          onClick={() => props.onSize(s)}
        >
          {s}
        </button>
      ))}
      <span className="note-toolbar__divider" aria-hidden="true" />
      <button
        type="button"
        className="note-toolbar__delete"
        aria-label="Delete text"
        title="Delete text"
        onClick={props.onDelete}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v4.5M9.5 6.5v4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
