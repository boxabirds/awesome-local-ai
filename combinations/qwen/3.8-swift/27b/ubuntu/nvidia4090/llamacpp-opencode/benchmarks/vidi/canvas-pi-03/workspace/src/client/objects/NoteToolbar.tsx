import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from 'src/shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor: (c: StickyColor) => void;
  onDelete: () => void;
}

const COLOR_NAMES: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

/**
 * Floating toolbar for the selected note: six colour swatches and a delete
 * button. Rendered above the note in screen space (positioned by the caller)
 * so it does not scale with board zoom. Swatches are distinguishable by name
 * (tooltip + accessible label), not only by colour.
 *
 * Stops pointer propagation so clicks never reach the viewport
 * (which would clear the selection).
 */
export function NoteToolbar(props: NoteToolbarProps): JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label="Sticky note options"
      data-testid="note-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        backgroundColor: '#ffffff',
        border: '1px solid #d0d7de',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${COLOR_NAMES[c]} colour`}
          aria-pressed={props.color === c}
          title={`${COLOR_NAMES[c]} colour`}
          data-testid={`swatch-${c}`}
          onClick={() => props.onColor(c)}
          style={{
            width: 20,
            height: 20,
            backgroundColor: STICKY_COLORS[c],
            border: props.color === c ? '2px solid #1A73E8' : '1px solid rgba(0,0,0,0.3)',
            borderRadius: '50%',
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <span style={{ width: 8 }} aria-hidden="true" />
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        data-testid="delete-note-button"
        onClick={props.onDelete}
        style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
          border: '1px solid #d0d7de',
          borderRadius: 6,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {/* Bin glyph */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.5 4h11M6 4V2.5h4V4M4 4l.8 9h6.4L12 4M6.5 6.5v4M9.5 6.5v4"
            fill="none"
            stroke="#c62828"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
