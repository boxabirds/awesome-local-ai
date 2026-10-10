// Toolbar for a single selected text object: the four S/M/L/XL size buttons
// (current size pressed) and Delete. Rendered inside the selection bar.

import { TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

const SIZE_KEYS = Object.keys(TEXT_SIZES) as readonly TextSize[];

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): React.JSX.Element {
  return (
    <>
      {SIZE_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className="text-size-button"
          data-testid={`text-size-${key}`}
          aria-label={`Text size ${key}`}
          title={`Text size ${key} (${TEXT_SIZES[key]} units)`}
          aria-pressed={key === size}
          onClick={() => onSize(key)}
        >
          {key}
        </button>
      ))}
      <button
        type="button"
        className="selection-delete"
        data-testid="delete-selection"
        aria-label="Delete selection"
        onClick={onDelete}
      />
    </>
  );
}
