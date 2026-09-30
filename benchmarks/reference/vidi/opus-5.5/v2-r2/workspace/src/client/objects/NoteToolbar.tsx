import { STICKY_COLORS, type StickyColor } from '../../shared/config';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

function colourLabel(color: StickyColor): string {
  return `${color[0].toUpperCase()}${color.slice(1)} colour`;
}

/** Floating toolbar for the selected note: six colour swatches and a delete button. */
export function NoteToolbar(props: {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}): React.JSX.Element {
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Note"
      // Clicks here must never reach the board or the note (clear selection, drag, edit).
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {COLOR_NAMES.map((color) => (
        <button
          key={color}
          type="button"
          className="note-toolbar-swatch"
          aria-label={colourLabel(color)}
          title={colourLabel(color)}
          aria-pressed={props.color === color}
          data-color={color}
          style={{ backgroundColor: STICKY_COLORS[color] }}
          onClick={() => props.onColor(color)}
        />
      ))}
      <span className="note-toolbar-divider" aria-hidden="true" />
      <button type="button" className="note-toolbar-delete" aria-label="Delete note" title="Delete note" onClick={props.onDelete}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h1.5v-8H10Zm3.5 0v8H15v-8h-1.5Z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}
