/**
 * Floating toolbar for the selected sticky note: colour swatches + delete.
 * Rendered in screen space above the note (not scaled by zoom).
 */

import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  return (
    <div
      data-testid="note-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: -44,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        backgroundColor: 'white',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        zIndex: 1000,
      }}
    >
      {COLOR_NAMES.map((name) => (
        <button
          key={name}
          data-testid={`swatch-${name}`}
          aria-label={`${name.charAt(0).toUpperCase() + name.slice(1)} colour`}
          aria-pressed={color === name}
          onClick={() => onColor(name)}
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: color === name ? '2px solid #333' : '1px solid #ccc',
            backgroundColor: STICKY_COLORS[name],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <button
        data-testid="delete-note-btn"
        aria-label="Delete note"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          border: 'none',
          backgroundColor: 'transparent',
          cursor: 'pointer',
          fontSize: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: 4,
        }}
      >
        🗑
      </button>
    </div>
  );
}
