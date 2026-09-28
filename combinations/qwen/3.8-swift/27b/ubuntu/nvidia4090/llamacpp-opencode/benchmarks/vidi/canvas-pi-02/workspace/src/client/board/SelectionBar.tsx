// Selection bar (story 7, sel.bar): shown above the selection's bounding
// box. For ≥2 selected objects it shows "N selected" (aria-live) and a
// Delete button; for exactly one sticky note it is story 2's NoteToolbar
// (colour + delete); for a single non-sticky object there is nothing yet
// (type toolbars come with stories 9-12).

import type { ReactElement } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';
import { NoteToolbar } from '../objects/NoteToolbar';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  disabled?: boolean;
  onDelete(): void;
  onColor(id: string, color: StickyColor): void;
}

export function SelectionBar(props: SelectionBarProps): ReactElement | null {
  const objects = props.snapshot.filter((o) => props.ids.has(o.id));
  if (objects.length === 0) return null;

  // Exactly one sticky note: story 2's note toolbar, unchanged.
  if (objects.length === 1) {
    const sticky = objects[0];
    const color = sticky.color;
    if (sticky.type === 'sticky' && color !== undefined) {
      return (
        <NoteToolbar
          color={color}
          disabled={props.disabled}
          onColor={(c) => props.onColor(sticky.id, c)}
          onDelete={props.onDelete}
        />
      );
    }
    // A single non-sticky object gets no toolbar yet (stories 9-12).
    return null;
  }

  // A single non-sticky object gets no toolbar yet (stories 9-12).
  if (objects.length === 1) return null;

  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="selection-bar-count" aria-live="polite">
        {objects.length} selected
      </span>
      <button
        type="button"
        className="selection-bar-delete"
        aria-label="Delete selection"
        title="Delete selection"
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
