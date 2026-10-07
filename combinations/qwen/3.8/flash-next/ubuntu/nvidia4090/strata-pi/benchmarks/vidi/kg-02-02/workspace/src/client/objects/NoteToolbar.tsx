import { STICKY_COLORS, type StickyColor } from "../../shared/config";

export interface NoteToolbarProps {
  /** Current colour, so the matching swatch reads as pressed. */
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/** Swatches are named, so colour is never the only way to tell them apart. */
export const STICKY_COLOR_LABELS: Record<StickyColor, string> = {
  yellow: "Yellow",
  orange: "Orange",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
  violet: "Violet",
};

export const STICKY_COLOR_ORDER: StickyColor[] = [
  "yellow",
  "orange",
  "green",
  "blue",
  "pink",
  "violet",
];

export const DELETE_NOTE_LABEL = "Delete note";

/**
 * The small floating toolbar shown above the selected note: six colour
 * swatches and a bin button. Rendered counter-scaled by the caller so it keeps
 * a constant screen size at any board zoom.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  const stop = (event: { stopPropagation(): void }) => {
    // A click on the toolbar is never a click on the board (which would clear
    // the selection).
    event.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      {STICKY_COLOR_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="note-swatch"
          data-color={name}
          data-testid={`color-${name}`}
          aria-label={`${STICKY_COLOR_LABELS[name]} colour`}
          aria-pressed={color === name}
          title={STICKY_COLOR_LABELS[name]}
          style={{ background: STICKY_COLORS[name] }}
          onClick={() => onColor(name)}
        />
      ))}
      <button
        type="button"
        className="note-delete"
        data-testid="delete-note"
        aria-label={DELETE_NOTE_LABEL}
        title={DELETE_NOTE_LABEL}
        onClick={onDelete}
      >
        <span aria-hidden="true">{"\u{1F5D1}"}</span>
      </button>
    </div>
  );
}
