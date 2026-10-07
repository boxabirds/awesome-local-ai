import { type PointerEvent as ReactPointerEvent } from "react";
import { STICKY_COLORS, type StickyColor } from "../../shared/config";

/**
 * Floating toolbar for the selected note: six colour swatches and a delete
 * (bin) button. Rendered in screen space by `App` so it does not scale with
 * board zoom, and hidden while the note is being dragged or edited.
 *
 * Swatches are named, not just coloured: `aria-label="<Colour> colour"` plus
 * the same text as a tooltip, and `aria-pressed` for the current colour.
 */
export const DELETE_BUTTON_LABEL = "Delete note";

const COLOR_LABELS: Record<StickyColor, string> = {
  yellow: "Yellow",
  orange: "Orange",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
  violet: "Violet",
};

export const STICKY_COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  const stop = (event: ReactPointerEvent<HTMLElement>) => {
    // Never reaches the viewport, which would clear the selection.
    event.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Sticky note options"
      onPointerDown={stop}
      onPointerUp={stop}
    >
      {STICKY_COLOR_ORDER.map((name) => {
        const label = `${COLOR_LABELS[name]} colour`;
        return (
          <button
            key={name}
            type="button"
            className="note-color-swatch"
            data-testid={`color-${name}`}
            data-color-name={name}
            aria-label={label}
            title={label}
            aria-pressed={name === color}
            style={{ background: STICKY_COLORS[name] }}
            onClick={() => onColor(name)}
          />
        );
      })}
      <button
        type="button"
        className="note-delete-button"
        data-testid="delete-note-button"
        aria-label={DELETE_BUTTON_LABEL}
        title={DELETE_BUTTON_LABEL}
        onClick={onDelete}
      >
        <span aria-hidden="true">🗑</span>
      </button>
    </div>
  );
}
