// Story 9: the floating toolbar for one selected text object
// (anchor: text.size): S/M/L/XL size buttons (current one pressed) and Delete.

import type { JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

const SIZES: readonly TextSize[] = Object.keys(TEXT_SIZES) as TextSize[];

export function TextToolbar(props: {
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}): JSX.Element {
  return (
    <div className="text-toolbar" role="toolbar" aria-label="Text tools">
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          className="text-toolbar__size"
          title={`Text size ${s}`}
          aria-label={`Text size ${s}`}
          aria-pressed={props.size === s}
          onClick={() => props.onSize(s)}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        className="text-toolbar__delete"
        title="Delete text"
        aria-label="Delete text"
        onClick={props.onDelete}
      >
        Delete
      </button>
    </div>
  );
}
