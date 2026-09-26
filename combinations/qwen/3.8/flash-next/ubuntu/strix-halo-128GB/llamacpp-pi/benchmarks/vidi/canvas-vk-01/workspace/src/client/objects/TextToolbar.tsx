import { type JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

/**
 * Floating toolbar above a single selected text object (story 9): the four
 * size presets and a delete button. Rendered in screen space like the note
 * toolbar; a size change re-lays out the text but never moves the object.
 */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): JSX.Element {
  return (
    <div
      className="note-toolbar"
      data-testid="text-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {(Object.keys(TEXT_SIZES) as (keyof typeof TEXT_SIZES)[]).map((name) => (
        <button
          key={name}
          type="button"
          aria-label={`Text size ${name}`}
          aria-pressed={size === name}
          data-testid={`text-size-${name}`}
          className="note-toolbar-button"
          title={`Size ${name} (${TEXT_SIZES[name]} px)`}
          onClick={() => onSize(name)}
        >
          {name}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete text"
        data-testid="delete-text"
        className="note-toolbar-delete"
        onClick={onDelete}
      >
        &#x1F5D1;
      </button>
    </div>
  );
}
