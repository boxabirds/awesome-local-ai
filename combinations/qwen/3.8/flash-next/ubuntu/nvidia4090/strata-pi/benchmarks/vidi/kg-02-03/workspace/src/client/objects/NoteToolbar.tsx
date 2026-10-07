import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { STICKY_COLORS, type StickyColor } from "../../shared/config";

/**
 * The floating toolbar of the selected sticky note: six colour swatches and a
 * delete (bin) button. Rendered in screen space (the caller counter-scales it)
 * so it keeps the same size at every zoom, and hidden while dragging or editing.
 */
export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/** Swatch order is the order in `STICKY_COLORS`: yellow, orange, green, blue, pink, violet. */
export const STICKY_COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

/** "pink" -> "Pink", so swatches are named, not just coloured. */
export function stickyColorLabel(color: StickyColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  // Clicks on the toolbar must never reach the viewport, which would clear the
  // selection the toolbar belongs to.
  const stop = (event: ReactPointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Sticky note tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onPointerCancel={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {STICKY_COLOR_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="note-swatch"
          data-testid={`swatch-${name}`}
          data-color={name}
          aria-label={`${stickyColorLabel(name)} colour`}
          aria-pressed={color === name}
          title={`${stickyColorLabel(name)} colour`}
          style={{ background: STICKY_COLORS[name] }}
          onClick={() => onColor(name)}
        />
      ))}
      <button
        type="button"
        className="note-delete"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        <span aria-hidden="true">🗑</span>
      </button>
    </div>
  );
}
