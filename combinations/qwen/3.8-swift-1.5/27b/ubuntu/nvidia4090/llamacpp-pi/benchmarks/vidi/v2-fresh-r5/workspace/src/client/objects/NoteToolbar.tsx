import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

interface NoteToolbarProps {
  color: StickyColor;
  onColor: (c: StickyColor) => void;
  onDelete: () => void;
}

/**
 * Floating toolbar shown above the selected note. Contains six colour swatches
 * and a delete button.
 */
export function NoteToolbar(props: NoteToolbarProps): JSX.Element {
  const { color, onColor, onDelete } = props;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note toolbar"
      onPointerDown={handlePointerDown}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 8px',
        background: 'white',
        borderRadius: '6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${c} colour`}
          aria-pressed={color === c}
          title={`${c[0].toUpperCase() + c.slice(1)} colour`}
          data-testid={`swatch-${c}`}
          onClick={() => onColor(c)}
          style={{
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            border: color === c ? '2px solid #333' : '1px solid rgba(0,0,0,0.2)',
            background: STICKY_COLORS[c],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        data-testid="delete-note-btn"
        onClick={onDelete}
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '4px',
          border: '1px solid rgba(0,0,0,0.2)',
          background: 'white',
          cursor: 'pointer',
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: '4px',
        }}
      >
        🗑
      </button>
    </div>
  );
}
