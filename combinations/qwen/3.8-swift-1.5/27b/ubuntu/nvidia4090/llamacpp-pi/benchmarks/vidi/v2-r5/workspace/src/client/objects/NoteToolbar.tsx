// src/client/objects/NoteToolbar.tsx
import type { ReactElement } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor: (c: StickyColor) => void;
  onDelete: () => void;
}

const COLOR_NAMES: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

export function NoteToolbar(props: NoteToolbarProps): ReactElement {
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        background: 'white',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {COLOR_NAMES.map((name) => (
        <button
          key={name}
          aria-label={`${name} colour`}
          aria-pressed={props.color === name}
          title={`${name[0].toUpperCase() + name.slice(1)} colour`}
          data-testid={`swatch-${name}`}
          onClick={() => props.onColor(name)}
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            border: props.color === name ? '2px solid #333' : '1px solid #ccc',
            background: STICKY_COLORS[name],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <button
        aria-label="Delete note"
        title="Delete note"
        data-testid="delete-note-btn"
        onClick={props.onDelete}
        style={{
          width: 24,
          height: 24,
          borderRadius: 4,
          border: '1px solid #ccc',
          background: 'white',
          cursor: 'pointer',
          fontSize: 14,
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
