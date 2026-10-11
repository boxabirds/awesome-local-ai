import type { JSX } from 'react';

import { TEXT_SIZE_NAMES } from '../../shared/objects/text';
import type { TextSize } from '../../shared/config';
import { BinIcon } from './icons';

/**
 * What each size preset is called out loud (`text.size`): a button that says only
 * “S” is a puzzle, and one that says “Small” is not. The letters stay on the
 * button, because a size picked from four letters is quicker than a menu.
 */
export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

export interface TextToolbarProps {
  /** The size the selected text has; its button reads as pressed. */
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
  /** The whole toolbar is inert while the board cannot be written to. */
  disabled?: boolean;
}

/**
 * The toolbar above one selected piece of text: the four size presets and delete
 * (`text.size`, `text.delete`).
 *
 * Size is the only thing it offers, and the only thing a heading has besides its
 * words: there is no colour to pick (a heading has no fill), no shape, no font to
 * choose. Width is not here either, because a width is something you do to the box
 * with its handle, and `text.fixed_width` puts it there rather than in a menu.
 *
 * Like the note toolbar it stops pointer and double-click events, so a press on it
 * never clears the selection it belongs to, and never starts a note.
 */
export function TextToolbar({ size, onSize, onDelete, disabled = false }: TextToolbarProps): JSX.Element {
  return (
    <div
      className="text-toolbar"
      data-testid="text-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {TEXT_SIZE_NAMES.map((name) => {
        const label = `${TEXT_SIZE_LABELS[name]} text`;
        return (
          <button
            key={name}
            type="button"
            className="text-size-button"
            data-testid={`text-size-${name}`}
            aria-label={label}
            title={`${label} (${name})`}
            aria-pressed={size === name}
            disabled={disabled}
            onClick={() => {
              onSize(name);
            }}
          >
            {name}
          </button>
        );
      })}
      <button
        type="button"
        className="text-delete"
        data-testid="text-delete"
        aria-label="Delete text"
        title="Delete text"
        disabled={disabled}
        onClick={onDelete}
      >
        <BinIcon />
      </button>
    </div>
  );
}
