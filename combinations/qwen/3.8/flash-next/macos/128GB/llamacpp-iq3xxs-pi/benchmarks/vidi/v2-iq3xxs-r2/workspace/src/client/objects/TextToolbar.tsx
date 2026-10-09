import type { JSX } from 'react';
import { TEXT_SIZE_KEYS, type TextSize } from '../../shared/objects/text';

/** What the four size buttons are called out loud, in the order they are shown. */
const SIZE_LABELS: Record<TextSize, string> = {
  S: 'Small text',
  M: 'Medium text',
  L: 'Large text',
  XL: 'Extra large text',
};

export interface TextToolbarProps {
  /** The size the selected text has now; its button is the pressed one. */
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

/**
 * The size buttons for exactly one selected text object (PRD: "In the small text toolbar
 * above it she picks XL").
 *
 * It is part of the `SelectionBar` rather than a toolbar the object carries itself, because
 * a size is a property of one object: three texts and a note do not have a size to pick
 * together, and a "make these three XL" button would have to know which of them it was
 * talking about. Same reason a sticky note's colours live in `NoteToolbar`.
 *
 * The four sizes are the settings in `TEXT_SIZES`, in that order, and pressing one changes
 * nothing else — the text stays where its top-left was (TC-21).
 */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): JSX.Element {
  return (
    <>
      <span className="vidi6-toolbar-group" data-testid="text-sizes" role="group" aria-label="Text size">
        {TEXT_SIZE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="vidi6-text-size"
            data-testid={`text-size-${key}`}
            data-size={key}
            aria-label={SIZE_LABELS[key]}
            aria-pressed={key === size}
            title={`${SIZE_LABELS[key]} (${key})`}
            onClick={() => onSize(key)}
          >
            {key}
          </button>
        ))}
      </span>
      <button
        type="button"
        className="vidi6-selection-delete"
        aria-label="Delete selection"
        onClick={onDelete}
      >
        Delete
      </button>
    </>
  );
}
