import type { JSX } from 'react';
/**
 * Floating toolbar for the selected note: colour swatches + delete button.
 * Rendered in screen space (not scaled with zoom), above the note.
 */
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

const COLOR_LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

export function NoteToolbar(props: {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}): JSX.Element {
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="note-swatch"
          aria-label={`${COLOR_LABELS[c]} colour`}
          aria-pressed={c === props.color}
          title={`${COLOR_LABELS[c]} colour`}
          style={{ backgroundColor: STICKY_COLORS[c] }}
          onClick={() => props.onColor(c)}
        />
      ))}
      <button
        type="button"
        className="note-delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={props.onDelete}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3 4h10l-1 10H4L3 4zm3-2h4M6 7v4M10 7v4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
