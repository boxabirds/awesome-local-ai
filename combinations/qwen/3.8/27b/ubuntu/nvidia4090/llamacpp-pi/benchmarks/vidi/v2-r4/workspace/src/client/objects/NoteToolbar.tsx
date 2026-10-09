/**
 * The per-note toolbar (story 2): six colour swatches and a delete (trash)
 * button, shown above the selected note in screen space.
 *
 * All pointer events stop propagation so a click never reaches the
 * viewport (which would clear the selection) and a double-click never
 * creates a new note.
 */
import type * as React from "react";
import { STICKY_COLORS, type StickyColor } from "../../shared/config";

const COLOR_NAMES: Record<StickyColor, string> = {
  yellow: "Yellow",
  orange: "Orange",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
  violet: "Violet",
};

export function NoteToolbar(props: {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}): React.JSX.Element {
  const stop = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => (
        <button
          key={name}
          type="button"
          aria-label={`${COLOR_NAMES[name]} colour`}
          aria-pressed={props.color === name}
          className="note-toolbar__swatch"
          style={{ backgroundColor: STICKY_COLORS[name] }}
          onClick={() => props.onColor(name)}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        className="note-toolbar__delete"
        onClick={props.onDelete}
      >
        <span aria-hidden="true">🗑</span>
      </button>
    </div>
  );
}
