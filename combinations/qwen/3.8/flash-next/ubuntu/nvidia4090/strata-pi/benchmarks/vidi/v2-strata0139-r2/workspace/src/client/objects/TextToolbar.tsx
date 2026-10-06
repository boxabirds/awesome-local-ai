import { TEXT_SIZE_PRESETS } from "../../shared/objects/text";
import type { TextSize } from "../../shared/config";

/**
 * The text object's toolbar (`text.object`): the four size presets and Delete.
 *
 * It is drawn by the selection bar in screen space, so it keeps its size at any
 * board zoom, and every size button says which size it is and whether it is the
 * one in use (`aria-pressed`). Changing a size changes the font only: the object
 * stays exactly where it is, and its box is re-measured by the board's own box
 * sync.
 */
export interface TextToolbarProps {
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

const SIZE_LABELS: Record<TextSize, string> = {
  S: "small",
  M: "medium",
  L: "large",
  XL: "extra large",
};

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps) {
  return (
    <div
      className="text-toolbar"
      data-testid="text-toolbar"
      role="group"
      aria-label="Text tools"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {TEXT_SIZE_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          className="text-toolbar-size"
          data-testid={`text-size-${preset}`}
          aria-label={`Text size ${preset} (${SIZE_LABELS[preset]})`}
          title={`Text size ${preset} (${SIZE_LABELS[preset]})`}
          aria-pressed={preset === size}
          onClick={() => onSize(preset)}
        >
          {preset}
        </button>
      ))}
      <button
        type="button"
        className="text-toolbar-delete"
        data-testid="text-delete"
        aria-label="Delete text"
        title="Delete text"
        onClick={onDelete}
      >
        &#128465;
      </button>
    </div>
  );
}
