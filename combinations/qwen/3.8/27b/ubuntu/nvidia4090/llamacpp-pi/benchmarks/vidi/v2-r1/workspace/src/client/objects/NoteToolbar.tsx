// NoteToolbar (story 2, sticky.toolbar contract): colour swatches + delete
// for the selected note. Rendered in screen space above the note (never
// scaled by the camera zoom); hidden while the note is dragging or editing
// (the parent decides).

import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

export function NoteToolbar(props: NoteToolbarProps): JSX.Element {
  const { color, onColor, onDelete } = props;
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Sticky note options"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="note-toolbar__swatch"
          aria-label={`${COLOR_NAMES[c]} colour`}
          aria-pressed={color === c}
          title={`${COLOR_NAMES[c]} colour`}
          style={{ background: STICKY_COLORS[c] }}
          onClick={() => onColor(c)}
        />
      ))}
      <button
        type="button"
        className="note-toolbar__delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.8 9.5h6.4L12 4M6.5 6.5v5M9.5 6.5v5" />
        </svg>
      </button>
    </div>
  );
}
