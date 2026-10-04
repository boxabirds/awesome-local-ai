import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { TEXT_SIZE_LABELS, type TextSize } from '../../shared/config';
import { TEXT_SIZE_ORDER } from '../../shared/objects/text';

export interface TextToolbarProps {
  /** The text's current size, shown as pressed. */
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

/**
 * The bar shown under the tools while exactly one text object is selected: four sizes and a
 * delete.
 *
 * The four sizes are the whole of the size control, and they are four buttons rather than a
 * slider or a number field because "how big should this heading be?" is answered by looking at it,
 * and a person chooses from four things they can see far faster than they type a pixel value. Each
 * is `aria-pressed`, so the size the text is at is the size the bar says it is.
 *
 * A text object has no colours to choose, which is why this bar appears where a single note's own
 * toolbar appears: an object that is alone on the board and has one property to set needs a bar of
 * its own, and the selection bar's count of "1 selected" would be a bar that says something
 * obvious and offers nothing.
 */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };
  return (
    <div
      className="text-toolbar"
      data-board-ui=""
      data-testid="text-toolbar"
      role="group"
      aria-label="Text toolbar"
      onPointerDown={stop}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      {TEXT_SIZE_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className={`text-toolbar__size text-toolbar__size--${name}`}
          data-testid="text-size"
          data-size={name}
          aria-label={`${TEXT_SIZE_LABELS[name]} (${name})`}
          title={`${TEXT_SIZE_LABELS[name]} (${name})`}
          aria-pressed={name === size}
          onClick={() => {
            onSize(name);
          }}
        >
          {name}
        </button>
      ))}
      <button
        type="button"
        className="text-toolbar__delete"
        data-testid="text-delete"
        aria-label="Delete text"
        title="Delete text"
        onClick={onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M7 21a2 2 0 0 1-2-2V6H4V4h5V2h6v2h5v2h-1v13a2 2 0 0 1-2 2H7Zm10-15H7v12h10V6ZM9 8h2v9H9V8Zm4 0h2v9h-2V8Z"
          />
        </svg>
      </button>
    </div>
  );
}
