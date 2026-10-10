import { useCallback } from 'react';
import { TEXT_SIZE_LABELS, TEXT_SIZE_NAMES, type TextSize } from '../../shared/config';

/**
 * The toolbar for one selected text object: the four sizes and a delete button
 * (anchor `text.object`).
 *
 * The size is the only thing about the *letters* a person may change from here -
 * how wide a text object is comes from its handles or from what was typed into it.
 * `aria-pressed` says which size is in force, so the current size is readable
 * without looking at the text itself (TC-21).
 *
 * It is board chrome: a pointer that lands here belongs to the toolbar and never
 * reaches the viewport underneath, which would clear the selection.
 */
export interface TextToolbarProps {
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

export function TextToolbar(props: TextToolbarProps) {
  const { size, onSize, onDelete } = props;

  const stop = useCallback((event: React.SyntheticEvent) => {
    // Keep focus on whatever is being edited: changing the size of the text this
    // person is typing into is a change to the text, not a move to something else.
    if (event.type === 'pointerdown') {
      event.preventDefault();
    }
    event.stopPropagation();
  }, []);

  return (
    <div
      className="text-toolbar"
      data-testid="text-toolbar"
      data-board-chrome="true"
      role="toolbar"
      aria-label="Text tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      <div className="text-toolbar__sizes">
        {TEXT_SIZE_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className={`text-toolbar__size text-toolbar__size--${name}`}
            data-testid={`text-size-${name}`}
            data-size={name}
            aria-label={`Text size ${TEXT_SIZE_LABELS[name]}`}
            aria-pressed={size === name}
            title={`${TEXT_SIZE_LABELS[name]} text`}
            onClick={() => {
              onSize(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="text-toolbar__delete"
        data-testid="delete-text"
        aria-label="Delete text"
        title="Delete text"
        onClick={() => {
          onDelete();
        }}
      >
        Delete
      </button>
    </div>
  );
}
