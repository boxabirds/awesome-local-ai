import { STICKY_COLORS, type StickyColor } from "../../shared/config";

/**
 * Floating toolbar for the selected note: the six colour swatches and the bin
 * button. Rendered inside an anchor that cancels the world zoom, so the toolbar
 * keeps a constant size on screen.
 *
 * Swatches are named ("Green colour"), not only coloured, so colour is never
 * the only way to tell them apart.
 */
export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/** Display name of a colour key: `yellow` -> `Yellow`. */
export function stickyColorName(color: StickyColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

export const NOTE_TOOLBAR_LABEL = "Note tools";
export const DELETE_NOTE_LABEL = "Delete note";

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="group"
      aria-label={NOTE_TOOLBAR_LABEL}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => {
        const label = `${stickyColorName(name)} colour`;
        return (
          <button
            key={name}
            type="button"
            className="note-swatch"
            data-testid={`swatch-${name}`}
            data-color={name}
            aria-label={label}
            title={label}
            aria-pressed={name === color ? "true" : "false"}
            style={{ background: STICKY_COLORS[name] }}
            onClick={(event) => {
              event.stopPropagation();
              onColor(name);
            }}
          />
        );
      })}
      <button
        type="button"
        className="note-delete"
        data-testid="delete-note"
        aria-label={DELETE_NOTE_LABEL}
        title={DELETE_NOTE_LABEL}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path
            d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.6 9h5.8L11.5 4M6.5 6.5v4M9.5 6.5v4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
