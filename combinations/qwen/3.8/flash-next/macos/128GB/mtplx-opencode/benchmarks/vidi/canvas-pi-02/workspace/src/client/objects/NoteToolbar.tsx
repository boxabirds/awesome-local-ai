import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

/**
 * The floating toolbar of the selected note: six colour swatches and a bin.
 *
 * It is rendered inside the note but scaled by 1/zoom, so it stays the same
 * size on screen at every zoom level and never covers more of the note when
 * the user zooms in. Swatches carry a name (accessible label and tooltip), not
 * only a colour, so the six options are distinguishable without colour vision.
 */
export interface NoteToolbarProps {
  color: StickyColor;
  /** Current zoom, used to keep the toolbar at a constant screen size. */
  zoom?: number;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

const LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

export function NoteToolbar(props: NoteToolbarProps): JSX.Element {
  const zoom = props.zoom && Number.isFinite(props.zoom) && props.zoom > 0 ? props.zoom : 1;
  const colors = Object.keys(STICKY_COLORS) as StickyColor[];

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      data-note-ui="true"
      style={{ transform: `scale(${1 / zoom})` }}
      // Clicks on the toolbar must never reach the board, which would clear
      // the selection the toolbar belongs to.
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className="note-toolbar__swatch"
          data-testid="note-swatch"
          data-color={color}
          aria-label={`${LABELS[color]} colour`}
          aria-pressed={color === props.color}
          title={`${LABELS[color]} colour`}
          style={{ backgroundColor: STICKY_COLORS[color] }}
          onClick={() => {
            props.onColor(color);
          }}
        />
      ))}
      <button
        type="button"
        className="note-toolbar__delete"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        onClick={props.onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" focusable="false" aria-hidden="true">
          <path
            d="M3 4h8M5.5 4V2.5h3V4M4 4l.5 7.5h5L10 4"
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
