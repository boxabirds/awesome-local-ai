import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

function colorLabel(c: StickyColor): string {
  return `${c[0].toUpperCase()}${c.slice(1)} colour`;
}

/**
 * Floating toolbar for the selected note: six colour swatches (distinguishable
 * by name, not only by colour) and a delete (bin) button. Rendered in screen
 * space above the note (see StickyNote) so it does not scale with zoom.
 */
export function NoteToolbar(props: NoteToolbarProps): JSX.Element {
  return (
    <div
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      }}
    >
      {COLOR_NAMES.map((c) => (
        <button
          key={c}
          type="button"
          data-testid={`swatch-${c}`}
          aria-label={colorLabel(c)}
          aria-pressed={c === props.color}
          title={colorLabel(c)}
          onClick={() => props.onColor(c)}
          style={{
            width: 20,
            height: 20,
            padding: 0,
            borderRadius: 4,
            border: c === props.color ? '2px solid #333' : '1px solid rgba(0,0,0,0.25)',
            boxSizing: 'border-box',
            background: STICKY_COLORS[c],
            cursor: 'pointer',
          }}
        />
      ))}
      <button
        type="button"
        data-testid="delete-note-button"
        aria-label="Delete note"
        title="Delete note"
        onClick={props.onDelete}
        style={{
          width: 24,
          height: 24,
          padding: 0,
          border: 'none',
          borderRadius: 4,
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        🗑️
      </button>
    </div>
  );
}
