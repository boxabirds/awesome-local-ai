import type { SyntheticEvent } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

const SIZES = Object.keys(TEXT_SIZES) as TextSize[];

const SIZE_NAMES: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

/** "XL" → "Text size XL (Extra large)": the accessible name announces the size. */
export function sizeLabel(size: TextSize): string {
  return `Text size ${size} (${SIZE_NAMES[size]})`;
}

const stop = (e: SyntheticEvent) => e.stopPropagation();

/** Size presets and delete button for the selected text object (story 9). */
export function TextToolbar(props: { size: TextSize; onSize(s: TextSize): void; onDelete(): void }) {
  return (
    <div
      className="note-toolbar text-toolbar"
      role="toolbar"
      aria-label="Text toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      {SIZES.map((size) => (
        <button
          key={size}
          type="button"
          className="text-size-button"
          aria-label={sizeLabel(size)}
          title={SIZE_NAMES[size]}
          aria-pressed={props.size === size}
          onClick={() => props.onSize(size)}
        >
          {size}
        </button>
      ))}
      <span className="note-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="note-toolbar-delete"
        aria-label="Delete text"
        title="Delete text"
        onClick={props.onDelete}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
