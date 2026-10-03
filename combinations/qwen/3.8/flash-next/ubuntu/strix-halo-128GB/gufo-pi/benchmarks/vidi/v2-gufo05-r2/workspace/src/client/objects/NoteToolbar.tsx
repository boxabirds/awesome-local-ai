import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/** Colour names are shown capitalised in accessible labels ("Pink colour"). */
function colourLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

/**
 * The floating toolbar shown above the selected note (hidden while dragging or
 * editing). Six colour swatches and a delete button; the swatches are named by
 * colour, not only by colour. Pointer events stop here so the viewport never
 * clears the selection.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note tools"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      {COLOR_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="note-toolbar__swatch"
          aria-label={`${colourLabel(name)} colour`}
          title={`${colourLabel(name)} colour`}
          aria-pressed={name === color}
          style={{ backgroundColor: STICKY_COLORS[name] }}
          onClick={() => onColor(name)}
        />
      ))}
      <button
        type="button"
        className="note-toolbar__delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 2h4l.7.7H13v1.5H3V2.7h2.3L6 2Zm-1 4h6l-.5 8h-5L5 6Z"
          />
        </svg>
      </button>
    </div>
  );
}
