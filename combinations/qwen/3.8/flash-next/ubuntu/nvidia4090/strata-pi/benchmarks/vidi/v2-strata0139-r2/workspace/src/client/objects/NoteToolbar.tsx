import { STICKY_COLORS, type StickyColor } from "../../shared/config";

/**
 * The floating toolbar of the selected note: six colour swatches and a delete
 * (bin) button. It is rendered by `StickyNote` in screen space above the note,
 * so its size does not change with the board zoom.
 *
 * Swatches carry the colour *name* in both their accessible name and their
 * tooltip, so they are not distinguished by colour alone.
 *
 * Gestures that must never reach the board are stopped on the anchor element in
 * `StickyNote`: the viewport listens for `wheel` natively, ahead of React, so
 * React-level `stopPropagation` here would be too late.
 */
export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** "pink" -> "Pink" */
function colourLabel(color: StickyColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="group"
      aria-label="Note toolbar"
    >
      {COLOR_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          className="note-swatch"
          data-testid={`swatch-${name}`}
          data-color={name}
          aria-label={`${colourLabel(name)} colour`}
          aria-pressed={name === color}
          title={`${colourLabel(name)} colour`}
          style={{ background: STICKY_COLORS[name] }}
          onClick={() => onColor(name)}
        />
      ))}
      <button
        type="button"
        className="note-delete"
        data-testid="note-delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        &#128465;
      </button>
    </div>
  );
}
