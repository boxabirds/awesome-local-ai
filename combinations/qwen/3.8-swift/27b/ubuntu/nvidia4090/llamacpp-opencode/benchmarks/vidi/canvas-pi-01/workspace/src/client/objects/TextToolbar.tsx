// Text toolbar (see spec: text.object): size preset buttons S/M/L/XL with
// aria-pressed on the active size, plus Delete. Shown above a single
// selected text object (SelectionBar).

import type { JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): JSX.Element {
  return (
    <div className="note-toolbar" data-testid="text-toolbar" role="toolbar" aria-label="Text">
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          className="note-toolbar-size"
          aria-label={`Text size ${s} (${TEXT_SIZES[s]})`}
          aria-pressed={size === s}
          data-testid={`text-size-${s}`}
          onClick={() => onSize(s)}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        className="note-toolbar-delete"
        aria-label="Delete text"
        data-testid="text-delete"
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}
