import { TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  /** The size the selected text object is drawn at. */
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
  /** The board is locked (see `canEdit`). */
  disabled?: boolean;
}

/** The four presets, in the order the toolbar shows them (small → heading). */
export const TEXT_SIZE_ORDER: readonly TextSize[] = ['S', 'M', 'L', 'XL'];

/**
 * The toolbar of one selected text object: the four sizes and delete.
 *
 * The size buttons say what they do in their accessible names — "Small", "Medium",
 * "Large", "Extra large" — because a lone letter in a toolbar is a puzzle, and
 * `aria-pressed` carries which one is in force (PRD accessibility: size buttons
 * announce their size).
 */
export function TextToolbar({ size, onSize, onDelete, disabled = false }: TextToolbarProps) {
  return (
    <div
      className="note-toolbar text-toolbar"
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text actions"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {TEXT_SIZE_ORDER.map((preset) => (
        <button
          key={preset}
          type="button"
          className={`note-toolbar__color text-toolbar__size text-toolbar__size--${preset}`}
          aria-label={`${TEXT_SIZE_NAMES[preset]} text (${TEXT_SIZES[preset]})`}
          title={`${TEXT_SIZE_NAMES[preset]} (${TEXT_SIZES[preset]})`}
          data-testid={`text-size-${preset}`}
          aria-pressed={preset === size}
          disabled={disabled}
          onClick={() => onSize(preset)}
        >
          {preset}
        </button>
      ))}
      <button
        type="button"
        className="note-toolbar__delete"
        aria-label="Delete text"
        title="Delete"
        data-testid="text-delete"
        disabled={disabled}
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}

const TEXT_SIZE_NAMES: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};
