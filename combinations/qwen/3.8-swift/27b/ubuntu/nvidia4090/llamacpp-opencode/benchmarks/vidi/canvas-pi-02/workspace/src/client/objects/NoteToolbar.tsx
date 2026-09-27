// The floating note toolbar (story 2, sticky.toolbar): six colour swatches
// and a delete button for the selected note. Rendered in screen space by
// App (above the note, not scaled by zoom); hidden while dragging/editing.

import type { ReactElement } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export const NOTE_TOOLBAR_GAP_PX = 10;

const stop = (e: React.SyntheticEvent): void => e.stopPropagation();

function capitalize(color: StickyColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

export function NoteToolbar(props: NoteToolbarProps): ReactElement {
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={stop}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="note-toolbar-swatch"
          aria-label={`${capitalize(c)} colour`}
          aria-pressed={props.color === c}
          title={capitalize(c)}
          style={{ background: STICKY_COLORS[c] }}
          onClick={() => props.onColor(c)}
        />
      ))}
      <button type="button" className="note-toolbar-delete" aria-label="Delete note" title="Delete note" onClick={props.onDelete}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v4.5M9.5 6.5v4.5"
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
