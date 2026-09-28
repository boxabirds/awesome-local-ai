// The text object's selection toolbar (story 9, text.toolbar): shown
// above a single selected text object. Size buttons (S, M, L, XL — the
// current one pressed/highlighted, announcing the size) and Delete.

import type { ReactElement } from 'react';
import type { TextSize } from '../../shared/config';

export interface TextToolbarProps {
  /** The object's current size preset (the pressed button). */
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
  /** Non-editable board (load failed): the buttons do nothing (locked). */
  disabled?: boolean;
}

const SIZE_ORDER: TextSize[] = ['S', 'M', 'L', 'XL'];

export function TextToolbar(props: TextToolbarProps): ReactElement {
  return (
    <div
      className="text-toolbar"
      data-testid="text-toolbar"
      aria-label="Text tools"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {SIZE_ORDER.map((size) => (
        <button
          key={size}
          type="button"
          className="text-toolbar-size"
          data-size={size}
          aria-label={`Size ${size}`}
          title={`Size ${size}`}
          aria-pressed={props.size === size}
          disabled={props.disabled}
          onClick={() => props.onSize(size)}
        >
          {size}
        </button>
      ))}
      <button
        type="button"
        className="text-toolbar-delete"
        aria-label="Delete text"
        title="Delete text"
        disabled={props.disabled}
        onClick={props.onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M5.5 1.5h5M2.5 4h11M4 4l.7 9.3a1 1 0 0 0 1 .97h4.6a1 1 0 0 0 1-.97L12 4M6.5 7v4M9.5 7v4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
