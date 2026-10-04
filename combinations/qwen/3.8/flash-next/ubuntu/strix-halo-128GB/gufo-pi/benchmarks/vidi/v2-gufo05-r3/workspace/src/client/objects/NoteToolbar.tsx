import { STICKY_COLORS, type StickyColor } from '../../shared/config';

/** "yellow" -> "Yellow colour" — the accessible name and tooltip of a swatch. */
export function colorLabel(color: StickyColor): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

export const STICKY_COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

/**
 * Floating toolbar of the selected sticky note: the six colour swatches and the
 * delete (bin) button. Rendered above the note in screen space (the parent
 * counter-scales it) so it keeps a constant size at any zoom, and hidden by the
 * parent while dragging or editing.
 *
 * Colour swatches are named, not just coloured: each has an accessible label
 * and tooltip ("Green colour"), and `aria-pressed` marks the note's current
 * colour. Pointer events are stopped so a click here neither clears the
 * selection nor reaches the viewport.
 */
export function NoteToolbar(props: NoteToolbarProps) {
  const { color, onColor, onDelete } = props;
  const label = colorLabel(color);
  return (
    <div
      className="note-toolbar"
      data-note-toolbar=""
      role="toolbar"
      aria-label="Sticky note options"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {STICKY_COLOR_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="note-swatch"
          data-swatch={name}
          style={{ background: STICKY_COLORS[name] }}
          aria-label={colorLabel(name)}
          title={colorLabel(name)}
          aria-pressed={name === color}
          onClick={() => onColor(name)}
        />
      ))}
      <span className="note-toolbar-separator" aria-hidden="true" />
      <button
        type="button"
        className="note-delete"
        aria-label="Delete note"
        title="Delete note"
        data-delete-note=""
        onClick={onDelete}
      >
        <span aria-hidden="true">{'\u{1F5D1}\uFE0F'}</span>
      </button>
      <span className="sr-only" role="status">
        {`Current colour: ${label}`}
      </span>
    </div>
  );
}
