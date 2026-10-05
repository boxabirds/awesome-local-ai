/**
 * The floating toolbar of the selected text: the four sizes and the delete (bin).
 *
 * It is the whole of `text.size` — free text has no colour and no border, so its toolbar
 * is short. The size presets are named S M L XL and the current one says so, because
 * picking a size is picking how loud a sentence is from across the room, and a number in a
 * menu makes the user do the arithmetic.
 *
 * Like the note toolbar it lives inside the object and is counter-scaled by `1 / zoom`, so
 * it stays a constant size on screen whatever the zoom, and every control stops the
 * pointer rather than becoming a board gesture.
 */

import type { JSX } from 'react';
import { TEXT_SIZE_ORDER, TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  /** The text's current size preset, which is the pressed button. */
  size: TextSize;
  onSize(next: TextSize): void;
  onDelete(): void;
  /** False while the board cannot be written to (story 4): nothing here does anything. */
  disabled?: boolean;
}

/** Pointer and double-click events stop here: a click on the toolbar is not a board
 *  gesture and must not clear the selection or place another text. */
const stopPointer = (event: { stopPropagation(): void }) => {
  event.stopPropagation();
};

/** A button per size, labelled with the preset's name and told at in the tooltip. */
const SIZE_LABEL: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large'
};

export function TextToolbar(props: TextToolbarProps): JSX.Element {
  const { size, onSize, onDelete } = props;
  const disabled = props.disabled === true;

  return (
    <div
      className="vidi6-text-toolbar"
      data-vidi6="text-toolbar"
      role="toolbar"
      aria-label="Text options"
      onPointerDown={stopPointer}
      onDoubleClick={stopPointer}
    >
      {TEXT_SIZE_ORDER.map((preset) => (
        <button
          key={preset}
          type="button"
          className="vidi6-text-size"
          data-vidi6="text-size"
          data-size={preset}
          aria-label={`${SIZE_LABEL[preset]} text`}
          title={`${SIZE_LABEL[preset]} – ${TEXT_SIZES[preset]} px`}
          aria-pressed={preset === size}
          aria-disabled={disabled}
          disabled={disabled}
          onClick={() => onSize(preset)}
        >
          {preset}
        </button>
      ))}
      <span className="vidi6-text-toolbar-separator" aria-hidden="true" />
      <button
        type="button"
        className="vidi6-text-delete"
        data-vidi6="text-delete"
        aria-label="Delete text"
        aria-disabled={disabled}
        disabled={disabled}
        title={disabled ? 'This board could not be loaded' : 'Delete text'}
        onClick={onDelete}
      >
        {/* The same bin as the note toolbar, drawn inline so there is no icon dependency. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 2h4a1 1 0 0 1 1 1v1h3v1.5H2V4h3V3a1 1 0 0 1 1-1Zm1.5 1h1v.5h-1V3ZM3.5 7h9l-.6 6.2a1.5 1.5 0 0 1-1.5 1.3H5.6a1.5 1.5 0 0 1-1.5-1.3L3.5 7Z"
          />
        </svg>
      </button>
    </div>
  );
}
