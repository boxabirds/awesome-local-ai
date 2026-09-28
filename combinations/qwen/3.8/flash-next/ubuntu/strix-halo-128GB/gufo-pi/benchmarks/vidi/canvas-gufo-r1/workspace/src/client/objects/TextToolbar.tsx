import { TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

const SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[];

/**
 * Toolbar for a selected text object: S/M/L/XL size buttons + Delete.
 */
export function TextToolbar(props: TextToolbarProps) {
  const { size, onSize, onDelete } = props;

  return (
    <div
      className="text-toolbar"
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text formatting"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {SIZE_KEYS.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={`Size ${s}`}
          aria-pressed={s === size}
          data-testid={`text-size-${s}`}
          className={`text-toolbar-btn${s === size ? ' text-toolbar-active' : ''}`}
          onClick={() => onSize(s)}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete"
        data-testid="text-delete-btn"
        className="text-toolbar-btn text-toolbar-delete"
        onClick={onDelete}
        title="Delete text"
      >
        {'\u{1F5D1}'}
      </button>
    </div>
  );
}
