import React from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const ORDER: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

function label(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Floating toolbar for the selected note: six named colour swatches and a
 * delete (bin) button. Stops pointer events so a click here never reaches the
 * viewport (which would clear the selection).
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  return (
    <div
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note tools"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        backgroundColor: '#fff',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        width: 'max-content',
      }}
    >
      {ORDER.map((name) => (
        <button
          key={name}
          type="button"
          aria-label={`${label(name)} colour`}
          aria-pressed={color === name}
          title={`${label(name)} colour`}
          onClick={() => onColor(name)}
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: color === name ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.2)',
            backgroundColor: STICKY_COLORS[name],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
        style={{
          marginLeft: 4,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          fontSize: 15,
          lineHeight: 1,
          padding: '2px 4px',
        }}
      >
        🗑
      </button>
    </div>
  );
}
