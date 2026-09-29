// Floating toolbar for the selected sticky note (story 2): six colour swatches
// and a delete button. Rendered by StickyNote in an inverse-scaled wrapper so it
// stays a constant screen size regardless of zoom, and is hidden while the note
// is being dragged or edited.
import type React from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config.ts';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

export function NoteToolbar(props: NoteToolbarProps): React.JSX.Element {
  const { color, onColor, onDelete } = props;
  return (
    <div
      data-testid="note-toolbar"
      role="group"
      aria-label="Note toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        background: '#ffffff',
        border: '1px solid #e2e2e2',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {COLOR_NAMES.map((name) => {
        const hex = STICKY_COLORS[name];
        const selected = name === color;
        return (
          <button
            key={name}
            type="button"
            aria-label={`${name} colour`}
            title={`${name} colour`}
            aria-pressed={selected}
            onClick={() => onColor(name)}
            data-testid={`swatch-${name}`}
            style={{
              width: 18,
              height: 18,
              padding: 0,
              borderRadius: 4,
              cursor: 'pointer',
              background: hex,
              border: selected ? '2px solid #202020' : '1px solid #bdbdbd',
              boxSizing: 'border-box',
            }}
          />
        );
      })}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
        data-testid="note-delete"
        style={{
          marginLeft: 2,
          width: 22,
          height: 18,
          padding: 0,
          borderRadius: 4,
          cursor: 'pointer',
          border: '1px solid #d0d0d0',
          background: '#fff',
          lineHeight: 1,
          fontSize: 13,
          color: '#b00020',
        }}
      >
        🗑
      </button>
    </div>
  );
}
