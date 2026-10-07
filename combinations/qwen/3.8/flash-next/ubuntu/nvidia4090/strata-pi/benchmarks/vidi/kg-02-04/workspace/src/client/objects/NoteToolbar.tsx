import type { PointerEvent as ReactPointerEvent } from "react";
import {
  NOTE_TOOLBAR_GAP_SCREEN,
  NOTE_TOOLBAR_HEIGHT_SCREEN,
  STICKY_COLORS,
  STICKY_PADDING_WORLD,
  type StickyColor,
} from "../../shared/config";

/**
 * The floating toolbar of the selected note (sticky.toolbar): six colour
 * swatches and a delete button, in *screen* space above the note so it does not
 * grow and shrink with board zoom.
 *
 * Swatches are named (`aria-label` and tooltip), so a colour is not the only
 * way to tell them apart.
 */
export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
  /** Camera zoom, used to cancel the world layer's scale. */
  zoom: number;
}

/** Colour names exactly as the PRD lists them. */
export const STICKY_COLOR_NAMES = {
  yellow: "Yellow",
  orange: "Orange",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
  violet: "Violet",
} as const satisfies Record<StickyColor, string>;

export const DELETE_NOTE_LABEL = "Delete note";

export const STICKY_COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

export function NoteToolbar({ color, onColor, onDelete, zoom }: NoteToolbarProps) {
  const zoomSafe = zoom > 0 ? zoom : 1;
  const scale = 1 / zoomSafe;
  const offsetWorld =
    -(NOTE_TOOLBAR_HEIGHT_SCREEN + NOTE_TOOLBAR_GAP_SCREEN) / zoomSafe - STICKY_PADDING_WORLD;
  const stop = (event: ReactPointerEvent<HTMLDivElement>) => {
    // A toolbar click is never a board click: it must not pan the board or
    // clear the selection.
    event.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      onPointerDown={stop}
      onDoubleClick={(event) => event.stopPropagation()}
      style={{
        left: `${-STICKY_PADDING_WORLD}px`,
        // Anchored in world units so the gap and the toolbar stay the same
        // number of *screen* pixels at every zoom.
        top: `${offsetWorld}px`,
        height: `${NOTE_TOOLBAR_HEIGHT_SCREEN}px`,
        transform: `scale(${scale})`,
        transformOrigin: "0 0",
      }}
    >
      {STICKY_COLOR_ORDER.map((name) => {
        const label = `${STICKY_COLOR_NAMES[name]} colour`;
        return (
          <button
            key={name}
            type="button"
            className={`note-swatch note-swatch-${name}`}
            data-testid={`color-${name}`}
            aria-label={label}
            title={label}
            aria-pressed={color === name}
            style={{ background: STICKY_COLORS[name] }}
            onClick={() => onColor(name)}
          />
        );
      })}
      <span className="note-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="note-delete"
        data-testid="note-delete"
        aria-label={DELETE_NOTE_LABEL}
        title={DELETE_NOTE_LABEL}
        onClick={onDelete}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 9Z"
          />
        </svg>
      </button>
    </div>
  );
}
