/**
 * The floating toolbar of the selected text: the four sizes and the bin (story 9).
 *
 * It lives inside the text element but is counter-scaled by the board zoom, so it keeps a
 * constant size on screen - the same shape as the note's toolbar, because a person learns the
 * position once. The size is told by name as well as by how big the button looks, so the choice
 * does not depend on eyesight, and the pressed size is the object's stored size.
 */
import type { JSX } from 'react';
import type { TextSize } from '../../shared/config';

/** The sizes in the order they appear, smallest first. */
export const TEXT_SIZE_ORDER: readonly TextSize[] = ['S', 'M', 'L', 'XL'];

/** `"L"` -> `"Large text"`: a word, so the sizes are not told apart by size alone. */
const SIZE_LABELS: Record<TextSize, string> = {
  S: 'Small text',
  M: 'Medium text',
  L: 'Large text',
  XL: 'Extra large text',
};

export interface TextToolbarProps {
  /** The text's current size, shown as pressed. */
  size: TextSize;
  /** False while the board could not be loaded (story 4): disabled, not hidden. */
  canEdit?: boolean;
  onSize(size: TextSize): void;
  onDelete(): void;
}

function stopPropagation(event: { stopPropagation(): void }): void {
  // a click on the toolbar is not a click on the board (which would clear the selection)
  event.stopPropagation();
}

export function TextToolbar({
  size,
  canEdit = true,
  onSize,
  onDelete,
}: TextToolbarProps): JSX.Element {
  return (
    <div
      className="board-text__toolbar"
      data-text-toolbar
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text tools"
      onPointerDown={stopPropagation}
      onDoubleClick={stopPropagation}
    >
      {TEXT_SIZE_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="board-text__size"
          data-size={name}
          aria-label={SIZE_LABELS[name]}
          title={SIZE_LABELS[name]}
          disabled={!canEdit}
          aria-pressed={size === name}
          onClick={() => {
            onSize(name);
          }}
        >
          {name}
        </button>
      ))}
      <button
        type="button"
        className="board-text__delete"
        data-testid="text-delete"
        aria-label="Delete text"
        title="Delete text"
        disabled={!canEdit}
        onClick={() => {
          onDelete();
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 1.5h4a.75.75 0 0 1 .75.75V3H13a.75.75 0 0 1 0 1.5h-.35l-.55 8.1A1.75 1.75 0 0 1 10.36 14.3H5.64a1.75 1.75 0 0 1-1.74-1.7L3.35 4.5H3A.75.75 0 0 1 3 3h2.25v-.75A.75.75 0 0 1 6 1.5Zm1.5 1.5v-.5h1v.5h-1ZM5 4.5l.5 7.6h5L11 4.5H5Z"
          />
        </svg>
      </button>
    </div>
  );
}
