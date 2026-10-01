import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  STICKY_COLORS,
  type StickyColor,
} from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/** Capitalised colour name: the accessible label of each swatch. */
function colourName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const ORDER: readonly StickyColor[] = [
  'yellow',
  'orange',
  'green',
  'blue',
  'pink',
  'violet',
];

/**
 * The floating toolbar of the selected note: six colour swatches and a delete
 * (bin) button. It lives in screen space above the note (the parent
 * counter-scales it by 1/zoom) and stops pointer propagation, so clicking it
 * never pans the board or clears the selection.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): React.JSX.Element {
  const stop = (event: ReactMouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note toolbar"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={stop}
      onDoubleClick={stop}
    >
      {ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="note-swatch"
          data-testid={`swatch-${name}`}
          data-color={name}
          aria-label={`${colourName(name)} colour`}
          aria-pressed={name === color}
          title={`${colourName(name)} colour`}
          style={{ background: STICKY_COLORS[name] }}
          onClick={(event) => {
            stop(event);
            onColor(name);
          }}
        />
      ))}
      <button
        type="button"
        className="note-delete"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        onClick={(event) => {
          stop(event);
          onDelete();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 2h4l.5 1H13v1.5H3V3h2.5L6 2Zm-1.5 4h7L11 14.5H5L4.5 6Z"
          />
        </svg>
      </button>
    </div>
  );
}
