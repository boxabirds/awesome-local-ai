import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

const COLOR_LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

/**
 * The floating toolbar of the selected note (design "sticky.toolbar"): six
 * colour swatches and a delete button. Each swatch has an accessible name and
 * an `aria-pressed` state, so colour is not the only cue. The whole toolbar
 * swallows pointer events so a click never pans the board or clears the
 * selection.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Note options"
      data-testid="note-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => (
        <button
          key={name}
          type="button"
          className="note-toolbar__swatch"
          aria-label={`${COLOR_LABELS[name]} colour`}
          title={`${COLOR_LABELS[name]} colour`}
          aria-pressed={color === name}
          data-color={name}
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
        {'\u{1F5D1}'}
      </button>
    </div>
  );
}
