import type { JSX } from 'react';
import { STICKY_COLORS, STICKY_COLOR_LABELS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  /** Current colour of the note: its swatch is the pressed one. */
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/** Swatch order: the six colours as the PRD lists them. */
const COLOR_ORDER: readonly StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

/**
 * The floating toolbar of the selected note: six colour swatches and a bin
 * button. It is a child of the note (so it appears and disappears with it)
 * but scaled by 1/zoom in CSS, which keeps it the same size on screen at any
 * zoom and puts it just above the note's top edge.
 *
 * Every pointer event is stopped here: a click on a swatch must never reach
 * the viewport, which would treat it as a click on empty board space and
 * clear the selection.
 */
export function NoteToolbar(props: NoteToolbarProps): JSX.Element {
  const stop = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Sticky note toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onDoubleClick={stop}
    >
      {COLOR_ORDER.map((color) => (
        <button
          key={color}
          type="button"
          className={`note-swatch note-swatch-${color}`}
          data-testid={`note-swatch-${color}`}
          aria-label={`${STICKY_COLOR_LABELS[color]} colour`}
          title={`${STICKY_COLOR_LABELS[color]} colour`}
          aria-pressed={color === props.color}
          style={{ backgroundColor: STICKY_COLORS[color] }}
          onClick={() => {
            props.onColor(color);
          }}
        />
      ))}
      <button
        type="button"
        className="note-delete-button"
        data-testid="note-delete-button"
        aria-label="Delete note"
        title="Delete note"
        onClick={() => {
          props.onDelete();
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <path d="M2 3.5h10M5.5 3.5V2h3v1.5M3.5 3.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
    </div>
  );
}
