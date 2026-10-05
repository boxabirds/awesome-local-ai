/**
 * TextToolbar: S/M/L/XL size buttons + Delete for a selected text object (story 9).
 */
import { TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

const SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[];

/**
 * Size toolbar shown when exactly one text object is selected.
 * Buttons are S, M, L, XL with aria-pressed on the current size, plus Delete.
 */
export function TextToolbar(props: TextToolbarProps) {
  const { size, onSize, onDelete } = props;
  return (
    <div
      className="text-toolbar"
      data-text-toolbar=""
      role="toolbar"
      aria-label="Text size"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {SIZE_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className="text-toolbar-btn"
          aria-label={key}
          aria-pressed={key === size}
          data-text-size={key}
          onClick={() => onSize(key)}
        >
          {key}
        </button>
      ))}
      <button
        type="button"
        className="text-toolbar-delete"
        aria-label="Delete text"
        title="Delete text"
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}
