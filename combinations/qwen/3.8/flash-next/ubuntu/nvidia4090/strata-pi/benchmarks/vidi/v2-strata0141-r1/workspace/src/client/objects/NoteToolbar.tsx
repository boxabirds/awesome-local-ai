import { useCallback } from 'react';
import {
  STICKY_COLOR_NAMES,
  STICKY_COLORS,
  stickyColorLabel,
  type StickyColor,
} from '../../shared/config';

/**
 * The toolbar shown above a selected sticky note: the six colours and a delete
 * button (anchor `sticky.toolbar`). Hidden while the note is being dragged or
 * edited. It stops pointer events so a click never reaches the viewport (which
 * would clear the selection).
 */
export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

export function NoteToolbar(props: NoteToolbarProps) {
  const { color, onColor, onDelete } = props;

  const stop = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      data-board-chrome="true"
      role="toolbar"
      aria-label="Note tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      <div className="note-toolbar__colours">
        {STICKY_COLOR_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className="note-toolbar__swatch"
            data-testid={`swatch-${name}`}
            data-color={name}
            style={{ background: STICKY_COLORS[name] }}
            aria-label={stickyColorLabel(name)}
            aria-pressed={color === name}
            title={stickyColorLabel(name)}
            onClick={() => {
              onColor(name);
            }}
          />
        ))}
      </div>
      <button
        type="button"
        className="note-toolbar__delete"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        onClick={() => {
          onDelete();
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            d="M6 7h12M10 7V5h4v2M9 7v11h6V7M11 10v5M13 10v5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <span className="visually-hidden">Delete note</span>
      </button>
    </div>
  );
}
