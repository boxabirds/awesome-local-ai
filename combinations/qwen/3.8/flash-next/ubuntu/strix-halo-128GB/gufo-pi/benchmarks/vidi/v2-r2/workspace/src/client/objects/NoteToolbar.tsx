import type { ReactElement } from 'react';
import { STICKY_COLORS, type StickyColor } from '@shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): ReactElement {
  return (
    <div
      className="note-toolbar"
      data-board-ui="true"
      data-testid="note-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => (
        <button
          key={name}
          aria-label={`${name.charAt(0).toUpperCase() + name.slice(1)} colour`}
          aria-pressed={name === color}
          className="note-toolbar-swatch"
          style={{ backgroundColor: STICKY_COLORS[name] }}
          title={`${name.charAt(0).toUpperCase() + name.slice(1)} colour`}
          onClick={() => onColor(name)}
          data-testid={`swatch-${name}`}
        />
      ))}
      <button
        aria-label="Delete note"
        className="note-toolbar-delete"
        title="Delete note"
        onClick={onDelete}
        data-testid="delete-note-btn"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
