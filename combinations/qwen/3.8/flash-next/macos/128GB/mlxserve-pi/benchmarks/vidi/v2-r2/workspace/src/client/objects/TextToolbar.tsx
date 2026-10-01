// The Text toolbar (story 9): the four sizes and the bin, for the one text object
// that is selected. It is a per-object toolbar, so it shows for exactly one text
// and never for a group - a group gets the selection bar instead, and two toolbars
// would fight over the same corner of the screen.
//
// The buttons say S, M, L and XL: they are the names of the presets, and the
// button for the size the text already is stays pressed, so the text tells you how
// big it is without your having to measure it on screen. The size is a font size in
// world units - the same text at 50% zoom is half as tall on the screen, and so is
// its type.

import { type JSX } from 'react';
import type { TextSize } from '../../shared/config';
import { TEXT_SIZE_ORDER, TEXT_SIZES } from '../../shared/config';

export interface TextToolbarProps {
  /** The size of the one selected text object. */
  size: TextSize;
  /** A size button: the text reflows to this size, box included. */
  onSize(size: TextSize): void;
  /** The bin. */
  onDelete(): void;
}

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): JSX.Element {
  return (
    <div className="text-toolbar" data-testid="text-toolbar" role="group" aria-label="Text toolbar">
      {TEXT_SIZE_ORDER.map((preset) => (
        <button
          key={preset}
          type="button"
          // the button for the size the text already is is the pressed one, so the
          // toolbar states what it would change rather than what it just did
          data-testid={`text-size-${preset}`}
          className="text-toolbar-button"
          aria-pressed={preset === size}
          title={`${TEXT_SIZES[preset]} pixel text`}

          onClick={() => {
            onSize(preset);
          }}
        >
          {/* the preset's name is the button's label, and the order is the shared
              list's, so the DOM order is the model's order */}
          {preset}
        </button>
      ))}
      <button
        type="button"
        data-testid="text-toolbar-delete"
        className="text-toolbar-button text-toolbar-button--danger"
        onClick={() => {
          onDelete();
        }}
      >
        Delete
      </button>
    </div>
  );
}
