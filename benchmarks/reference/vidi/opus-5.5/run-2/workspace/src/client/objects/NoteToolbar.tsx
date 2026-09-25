/**
 * Floating toolbar of the selected note: six colour swatches and a delete button
 * (anchor: sticky.toolbar). The parent positions it; it never lets pointer input reach
 * the note (which would start a drag) or the board (which would clear the selection).
 */
import type { SyntheticEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

const COLOR_NAMES: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

export function colourLabel(color: StickyColor): string {
  return `${COLOR_NAMES[color]} colour`;
}

const COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

export function NoteToolbar(props: {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}): React.JSX.Element {
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Note"
      data-testid="note-toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
      onWheel={stop}
      onKeyDown={stop}
    >
      {COLOR_ORDER.map((c) => (
        <button
          key={c}
          type="button"
          className="swatch"
          aria-label={colourLabel(c)}
          title={colourLabel(c)}
          aria-pressed={props.color === c}
          style={{ backgroundColor: STICKY_COLORS[c] }}
          onClick={() => props.onColor(c)}
        />
      ))}
      <span className="note-toolbar-divider" aria-hidden="true" />
      <button type="button" className="note-delete" aria-label="Delete note" title="Delete note" onClick={props.onDelete}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
