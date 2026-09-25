import type { ReactElement, SyntheticEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '@/shared/config';

export interface NoteToolbarProps {
  /** Current colour of the selected note. */
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES: readonly StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

function colorLabel(color: StickyColor): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

/**
 * Floating toolbar for the selected sticky note: six colour swatches and a
 * delete (bin) button. Rendered in screen space (not scaled by zoom) above
 * the note by StickyNote. Stops pointer propagation so clicks never reach
 * the viewport (which would clear the selection).
 */
export function NoteToolbar(props: NoteToolbarProps): ReactElement {
  const stop = (e: SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note actions"
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={stop}
      onPointerUp={stop}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        background: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        userSelect: 'none',
      }}
    >
      {COLOR_NAMES.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={colorLabel(color)}
          aria-pressed={color === props.color}
          title={colorLabel(color)}
          data-testid={`swatch-${color}`}
          onClick={() => props.onColor(color)}
          style={{
            width: 20,
            height: 20,
            padding: 0,
            borderRadius: 4,
            border: color === props.color ? '2px solid rgba(0, 0, 0, 0.6)' : '1px solid rgba(0, 0, 0, 0.2)',
            background: STICKY_COLORS[color],
            cursor: 'pointer',
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        data-testid="delete-note"
        onClick={props.onDelete}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          padding: 0,
          borderRadius: 4,
          border: '1px solid rgba(0, 0, 0, 0.2)',
          background: 'transparent',
          cursor: 'pointer',
          color: 'rgba(0, 0, 0, 0.7)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M6 6l1 14h10l1-14" />
          <path d="M10 10v6M14 10v6" />
        </svg>
      </button>
    </div>
  );
}
