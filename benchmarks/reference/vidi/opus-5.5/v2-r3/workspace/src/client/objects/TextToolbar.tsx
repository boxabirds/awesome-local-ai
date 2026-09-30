import type { SyntheticEvent } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

const SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[];

const SIZE_NAMES: Record<TextSize, string> = { S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra large' };

/** Accessible name of a size button, e.g. "Size XL". */
export function sizeLabel(size: TextSize): string {
  return `Size ${size}`;
}

/** Toolbars must never let pointer input reach the object or the board. */
function stop(e: SyntheticEvent) {
  e.stopPropagation();
}

/** Floating toolbar for one selected text object: S, M, L, XL sizes and Delete (text.size). */
export function TextToolbar(props: { size: TextSize; onSize(s: TextSize): void; onDelete(): void }) {
  return (
    <div
      className="note-toolbar text-toolbar"
      role="toolbar"
      aria-label="Text"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      {SIZE_KEYS.map((size) => (
        <button
          key={size}
          type="button"
          className="text-size"
          aria-label={sizeLabel(size)}
          aria-pressed={props.size === size}
          title={`${SIZE_NAMES[size]} (${size})`}
          onClick={() => props.onSize(size)}
        >
          {size}
        </button>
      ))}
      <span className="note-toolbar-divider" aria-hidden="true" />
      <button type="button" className="note-delete" aria-label="Delete text" title="Delete text" onClick={props.onDelete}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M6 2h4M2.5 4h11M4 4l.7 9.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L12 4M6.5 6.5v5M9.5 6.5v5"
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
