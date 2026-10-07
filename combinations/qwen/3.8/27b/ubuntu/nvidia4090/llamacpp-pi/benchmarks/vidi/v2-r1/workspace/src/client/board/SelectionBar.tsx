// SelectionBar (story 7, sel.interaction): while two or more objects are
// selected, a bar shows "N selected" with a Delete button; an aria-live
// region announces the count. With exactly one sticky note selected the bar
// is hidden and the story 2 NoteToolbar is shown instead (by the board).

import type { JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
}

export function SelectionBar(props: SelectionBarProps): JSX.Element | null {
  const count = props.ids.size;
  if (count < 2) return null;
  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span className="selection-bar__count" aria-live="polite" data-testid="selection-count">
        {count} selected
      </span>
      <button
        type="button"
        className="selection-bar__delete"
        aria-label="Delete selection"
        title="Delete selection"
        onClick={props.onDelete}
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
