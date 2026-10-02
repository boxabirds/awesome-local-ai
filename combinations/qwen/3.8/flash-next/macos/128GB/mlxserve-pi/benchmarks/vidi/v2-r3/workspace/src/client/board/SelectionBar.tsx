import type { JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { TextSize, TextWidthMode } from '../../shared/config';
import { TextToolbar } from '../objects/TextToolbar';

export interface SelectionBarProps {
  /** The set of selected object ids. */
  ids: ReadonlySet<string>;
  /** The objects themselves, so the bar can tell what kind it has selected. */
  snapshot?: readonly ObjectSnapshot[];
  /** Called when the user clicks "Delete selection" or the text toolbar's bin. */
  onDelete(): void;
  /** The text toolbar's size and width-mode buttons, for the one text object
   * that is selected on its own. Where the write goes is the board's business;
   * this bar only says which button was pressed. */
  onTextSize?(size: TextSize): void;
  onTextMode?(mode: TextWidthMode): void;
}

/**
 * The selection bar shown when 2 or more objects are selected: "N selected" and a
 * "Delete selection" button.
 *
 * When exactly one object is selected and it is a text object, this is where its
 * toolbar lives — S, M, L, XL, the width mode and Delete — because the toolbar
 * belongs to the selection rather than to the object: it appears and disappears
 * with the selection, and it writes nothing that the selection did not ask for.
 * A sticky note's own toolbar, by contrast, is a child of the note.
 */
export function SelectionBar(props: SelectionBarProps): JSX.Element | null {
  const count = props.ids.size;

  const only = count === 1 && props.snapshot !== undefined ? singleTextOf(props.snapshot, props.ids) : null;
  if (only !== null) {
    return (
      <div className="selection-bar selection-bar-text" data-testid="selection-bar-text">
        <TextToolbar
          size={only.size}
          mode={only.widthMode}
          onSize={(size) => {
            props.onTextSize?.(size);
          }}
          onMode={(mode) => {
            props.onTextMode?.(mode);
          }}
          onDelete={props.onDelete}
        />
      </div>
    );
  }

  if (count < 2) return null;

  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection"
    >
      <span
        className="selection-count"
        data-testid="selection-count"
        aria-live="polite"
      >
        {count} selected
      </span>
      <button
        type="button"
        className="selection-delete-button"
        data-testid="selection-delete-button"
        aria-label="Delete selection"
        title="Delete selection"
        onClick={props.onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <path d="M2 3.5h10M5.5 3.5V2h3v1.5M3.5 3.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
    </div>
  );
}

/** The one selected object, if it is a text object; null for anything else. */
function singleTextOf(
  snapshot: readonly ObjectSnapshot[],
  ids: ReadonlySet<string>,
): Extract<ObjectSnapshot, { type: 'text' }> | null {
  if (ids.size !== 1) return null;
  const id = ids.values().next().value as string | undefined;
  if (id === undefined) return null;
  const object = snapshot.find((s) => s.id === id);
  return object !== undefined && object.type === 'text' ? object : null;
}
