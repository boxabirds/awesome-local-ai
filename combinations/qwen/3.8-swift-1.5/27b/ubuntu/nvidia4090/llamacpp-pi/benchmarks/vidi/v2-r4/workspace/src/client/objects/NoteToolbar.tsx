import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

export function NoteToolbar(props: NoteToolbarProps): JSX.Element {
  return (
    <div
      data-testid="note-toolbar"
      style={{
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        backgroundColor: 'white',
        border: '1px solid #ddd',
        borderRadius: 6,
        padding: '4px 6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {COLOR_NAMES.map((name) => (
        <button
          key={name}
          aria-label={`${name} colour`}
          aria-pressed={props.color === name}
          title={name}
          onClick={() => props.onColor(name)}
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            border: props.color === name ? '2px solid #333' : '1px solid #ccc',
            backgroundColor: STICKY_COLORS[name],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <button
        aria-label="Delete note"
        title="Delete note"
        onClick={props.onDelete}
        style={{
          width: 24,
          height: 24,
          borderRadius: 4,
          border: '1px solid #ccc',
          backgroundColor: 'white',
          cursor: 'pointer',
          marginLeft: 4,
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        🗑
      </button>
    </div>
  );
}
