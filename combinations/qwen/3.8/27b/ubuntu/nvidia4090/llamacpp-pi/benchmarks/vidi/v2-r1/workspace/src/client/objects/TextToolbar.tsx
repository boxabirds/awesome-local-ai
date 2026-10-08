// TextToolbar (story 9, text.sizes): shown above the single selected text
// object (never while it is being edited). The four size presets — the
// current one highlighted (aria-pressed) — plus Delete, which goes through
// the existing selection deletion (Delete key, SelectionBar and toolbar all
// use the same code path).

import type { JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  /** The selected text object's current size preset. */
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

export function TextToolbar(props: TextToolbarProps): JSX.Element {
  const { size, onSize, onDelete } = props;
  return (
    <div
      className="note-toolbar text-toolbar"
      role="toolbar"
      aria-label="Text options"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {(Object.keys(TEXT_SIZES) as TextSize[]).map((s) => (
        <button
          key={s}
          type="button"
          className="note-toolbar__size"
          aria-label={`Size ${s}`}
          aria-pressed={size === s}
          title={`Size ${s}`}
          onClick={() => onSize(s)}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        className="note-toolbar__delete"
        aria-label="Delete text"
        title="Delete text"
        onClick={onDelete}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.8 9.5h6.4L12 4M6.5 6.5v5M9.5 6.5v5" />
        </svg>
      </button>
    </div>
  );
}
