import { useRef } from 'react';
import { TEXT_SIZE_LABELS, TEXT_SIZES, type TextSize } from '../../shared/config';
import { useNativeStopPropagation } from './useNativeStopPropagation';

export interface TextToolbarProps {
  /** The size the selected text is shown at now. */
  size: TextSize;
  /** Apply a size to every selected object; the box is re-measured for the new height. */
  onSizeChange(size: TextSize): void;
  /** Remove every selected object through the board's history-aware actions (story 8). */
  onDelete(): void;
  /** The toolbar element's test id, so tests can tell the two toolbars apart. */
  testId?: string;
}

/**
 * The floating toolbar for selected text (story 9): four size buttons and Delete.
 * Size is per object — the buttons report the size all selected objects share, and a
 * mixed selection reports none until one is chosen.
 */
export function TextToolbar({
  size,
  onSizeChange,
  onDelete,
  testId = 'text-toolbar',
}: TextToolbarProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useNativeStopPropagation(ref);
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  const sizes = Object.keys(TEXT_SIZES) as TextSize[];

  return (
    <div
      ref={ref}
      className="object-toolbar text-toolbar"
      data-testid={testId}
      role="toolbar"
      aria-label="Text"
    >
      <div className="text-toolbar-sizes" role="group" aria-label="Text size">
        {sizes.map((key) => (
          <button
            key={key}
            type="button"
            className="tool-button text-size-button"
            data-testid={`text-size-${key}`}
            aria-label={TEXT_SIZE_LABELS[key]}
            title={TEXT_SIZE_LABELS[key]}
            aria-pressed={size === key}
            disabled={size === key}
            aria-disabled={size === key}
            onClick={size === key ? undefined : () => onSizeChange(key)}
          >
            <span className={`text-size-glyph text-size-glyph-${key}`} aria-hidden="true">
              {key}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="tool-button text-delete-button"
        data-testid="text-delete"
        aria-label="Delete text"
        title="Delete text – or press Delete"
        onClick={() => onDeleteRef.current()}
      >
        <span aria-hidden="true">{'\u{1F5D1}'}</span>
        <span className="toolbar-button-suffix">Delete</span>
      </button>
    </div>
  );
}
