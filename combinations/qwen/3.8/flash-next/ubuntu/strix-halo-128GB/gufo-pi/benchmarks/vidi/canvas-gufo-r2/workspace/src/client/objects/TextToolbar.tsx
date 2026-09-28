/**
 * Floating toolbar for a selected text object (story 9): S/M/L/XL size buttons + Delete.
 * Rendered in screen space above the text object.
 */
import type { JSX } from 'react';
import type { TextSize } from '../../shared/config';

const SIZES: readonly TextSize[] = ['S', 'M', 'L', 'XL'];

export function TextToolbar(props: {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}): JSX.Element {
  return (
    <div
      className="text-toolbar"
      data-testid="text-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          className="text-size-button"
          aria-label={`${s} text size`}
          aria-pressed={s === props.size}
          title={`${s} text size`}
          onClick={() => props.onSize(s)}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        className="text-delete"
        aria-label="Delete text"
        title="Delete text"
        onClick={props.onDelete}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3 4h10l-1 10H4L3 4zm3-2h4M6 7v4M10 7v4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
