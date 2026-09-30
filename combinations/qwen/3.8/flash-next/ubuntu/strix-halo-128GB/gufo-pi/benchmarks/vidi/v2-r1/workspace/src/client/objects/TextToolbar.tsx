import type { JSX } from 'react';

import { type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  /** The text object's current size. */
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

const SIZE_ORDER: TextSize[] = ['S', 'M', 'L', 'XL'];

/**
 * The floating toolbar for a selected text object: S/M/L/XL size buttons and Delete.
 *
 * Size buttons have `aria-pressed` for the current size. Pointer events stop here
 * so clicking the toolbar does not clear the selection.
 */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): JSX.Element {
  return (
    <div
      className="text-toolbar"
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text tools"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {SIZE_ORDER.map((s) => (
        <button
          key={s}
          type="button"
          className="text-toolbar__size"
          data-testid={`text-size-${s}`}
          aria-label={`Size ${s}`}
          aria-pressed={s === size}
          title={`Size ${s}`}
          onClick={() => onSize(s)}
          style={{ fontWeight: s === size ? 'bold' : 'normal' }}
        >
          {s}
        </button>
      ))}
      <span className="text-toolbar__divider" aria-hidden="true" />
      <button
        type="button"
        className="text-toolbar__delete"
        data-testid="delete-text"
        aria-label="Delete text"
        title="Delete text"
        onClick={onDelete}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 1.5h4a.75.75 0 0 1 .75.75V3h2.5a.75.75 0 0 1 0 1.5H13l-.7 8.05A1.75 1.75 0 0 1 10.56 14.2H5.44A1.75 1.75 0 0 1 3.7 12.55L3 4.5a.75.75 0 0 1-.25-1.5A.75.75 0 0 1 3.5 3H6v-.75A.75.75 0 0 1 6 1.5ZM5 4.5l.7 7.9a.25.25 0 0 0 .25.3h4.1a.25.25 0 0 0 .25-.25L11 4.5Zm1.5 1.5v6h1v-6Zm2.5 0v6h1v-6ZM6.5 3h3v-.5h-3Z"
          />
        </svg>
      </button>
    </div>
  );
}
