// Floating toolbar for the selected note: six colour swatches and a delete
// (bin) button. Rendered in screen space (counter-scaled against zoom) above
// the note, never while dragging or editing.

import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const COLOUR_NAMES: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): React.JSX.Element {
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note options"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => (
        <button
          key={name}
          type="button"
          className="sticky-swatch"
          data-testid={`swatch-${name}`}
          aria-label={`${COLOUR_NAMES[name]} colour`}
          aria-pressed={name === color}
          title={`${COLOUR_NAMES[name]} colour`}
          style={{ background: STICKY_COLORS[name] }}
          onClick={() => onColor(name)}
        />
      ))}
      <button
        type="button"
        className="sticky-delete"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5"
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
