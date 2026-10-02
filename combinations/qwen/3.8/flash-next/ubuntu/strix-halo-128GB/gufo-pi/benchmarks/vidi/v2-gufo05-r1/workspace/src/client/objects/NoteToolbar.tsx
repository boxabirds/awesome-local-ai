/**
 * The floating toolbar of the selected sticky note: six colour swatches and a
 * delete (bin) button.
 *
 * It is rendered inside the note but counter-scaled by `1 / zoom` (see
 * `StickyNote`), so it keeps a constant size on screen instead of growing with
 * the board. Every colour is named in its accessible name and tooltip, so the
 * swatches are not distinguished by colour alone.
 */
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

/** Display names for the palette, in toolbar order. */
const COLOR_LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  const stop = (event: React.SyntheticEvent) => {
    // Clicks here belong to the note, never to the board: they must not clear
    // the selection or start a pan.
    event.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Sticky note tools"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => (
        <button
          key={name}
          type="button"
          className={`note-toolbar__swatch${name === color ? ' note-toolbar__swatch--active' : ''}`}
          style={{ backgroundColor: STICKY_COLORS[name] }}
          aria-label={`${COLOR_LABELS[name]} colour`}
          aria-pressed={name === color}
          title={`${COLOR_LABELS[name]} colour`}
          onPointerDown={stop}
          onClick={() => {
            onColor(name);
          }}
        />
      ))}
      <button
        type="button"
        className="note-toolbar__delete"
        aria-label="Delete note"
        title="Delete note"
        onPointerDown={stop}
        onClick={() => {
          onDelete();
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <path
            d="M2.5 3.5h9M5.5 3.5V2h3v1.5M4 3.5l.6 8h4.8l.6-8M6 5.5v4M8 5.5v4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
