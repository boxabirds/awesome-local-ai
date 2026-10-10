import type { JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

const SIZES = Object.keys(TEXT_SIZES) as TextSize[];

// Floating toolbar above a single selected text object: the four size
// presets with the current one highlighted, plus Delete.
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): JSX.Element {
  return (
    <div
      className="note-toolbar text-toolbar"
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text toolbar"
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          className="text-toolbar-size"
          aria-label={`Size ${s}`}
          title={`Size ${s}`}
          aria-pressed={s === size}
          onClick={() => {
            onSize(s);
          }}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        className="note-toolbar-delete"
        aria-label="Delete text"
        title="Delete text"
        onClick={onDelete}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.6 9a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9L11.5 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
