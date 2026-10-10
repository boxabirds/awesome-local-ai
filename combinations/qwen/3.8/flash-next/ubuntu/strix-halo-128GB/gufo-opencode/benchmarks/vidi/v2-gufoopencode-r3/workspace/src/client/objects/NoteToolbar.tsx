import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

const COLOR_LABELS = Object.fromEntries(
  (Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => [
    name,
    name.charAt(0).toUpperCase() + name.slice(1)
  ])
) as Record<StickyColor, string>;

// Floating toolbar above the selected note (screen space, hidden while
// dragging or editing — controlled by the parent).
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note toolbar"
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => (
        <button
          key={name}
          type="button"
          className="note-toolbar-swatch"
          aria-label={`${COLOR_LABELS[name]} colour`}
          title={`${COLOR_LABELS[name]} colour`}
          aria-pressed={name === color}
          style={{ background: STICKY_COLORS[name] }}
          onClick={() => {
            onColor(name);
          }}
        />
      ))}
      <button
        type="button"
        className="note-toolbar-delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.6 9a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9L11.5 4"
            fill="none"
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
