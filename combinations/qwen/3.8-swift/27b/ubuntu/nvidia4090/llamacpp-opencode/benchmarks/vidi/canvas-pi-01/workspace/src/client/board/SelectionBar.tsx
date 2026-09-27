// Floating bar for the current selection (see spec: sel.ui).
//
// Two or more objects: "N selected" (aria-live) + a Delete button.
// Exactly one sticky note: the story 2 NoteToolbar (colour swatches + delete).
// Anything else: nothing.

import type { JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { DEFAULT_STICKY_COLOR, type StickyColor, type TextSize } from '../../shared/config';
import type { TextSnapshot } from '../../shared/objects/text';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  /** Single-sticky colour change. */
  onColor(color: StickyColor): void;
  /** Single-text size change (story 9). */
  onTextSize(size: TextSize): void;
  /** Delete the whole selection. */
  onDelete(): void;
}

export function SelectionBar(props: SelectionBarProps): JSX.Element | null {
  const { ids, snapshot, onColor, onTextSize, onDelete } = props;
  const count = ids.size;

  if (count >= 2) {
    return (
      <div data-testid="selection-bar" className="selection-bar" role="toolbar" aria-label="Selection actions">
        <span className="selection-bar__count">{count} selected</span>
        <button
          type="button"
          className="selection-bar__delete"
          aria-label="Delete selection"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M5.5 1.5h5l.5 1.5h3v2h-11v-2h3l.5-1.5zM3 6h10l-.6 8.4a1 1 0 0 1-1 .6H4.6a1 1 0 0 1-1-.6L3 6z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
    );
  }

  if (count === 1) {
    const [id] = ids.values();
    const obj = snapshot.find((o) => o.id === id);
    if (obj !== undefined && obj.type === 'sticky') {
      return <NoteToolbar color={obj.color ?? DEFAULT_STICKY_COLOR} onColor={onColor} onDelete={onDelete} />;
    }
    if (obj !== undefined && obj.type === 'text') {
      const size = (obj as ObjectSnapshot & TextSnapshot).size;
      return <TextToolbar size={size} onSize={onTextSize} onDelete={onDelete} />;
    }
    return null;
  }

  return null;
}
