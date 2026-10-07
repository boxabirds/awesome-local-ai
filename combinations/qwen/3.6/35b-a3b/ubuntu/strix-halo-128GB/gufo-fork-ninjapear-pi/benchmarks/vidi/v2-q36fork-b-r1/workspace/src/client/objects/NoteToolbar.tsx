import { type CSSProperties, type ReactNode } from 'react';
import { STICKY_COLORS, type StickyColor } from '@/shared/config';

interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): ReactNode {
  const containerStyle: CSSProperties = {
    position: 'absolute',
    bottom: 'calc(100% + 8px)',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 8px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    zIndex: 1000,
    whiteSpace: 'nowrap',
  };

  return (
    <div style={containerStyle} data-testid="note-toolbar" role="toolbar" aria-label="Note toolbar">
      {COLORS.map((c) => (
        <button
          key={c}
          aria-label={`${c} colour`}
          aria-pressed={c === color}
          title={`${c} colour`}
          onClick={(e) => {
            e.stopPropagation();
            onColor(c);
          }}
          style={{
            width: '24px',
            height: '24px',
            border: c === color ? '2px solid #2979ff' : '1px solid #ccc',
            borderRadius: '4px',
            backgroundColor: STICKY_COLORS[c],
            cursor: 'pointer',
            padding: 0,
          }}
          data-testid={`color-swatch-${c}`}
        />
      ))}
      <div style={{ width: '1px', height: '20px', backgroundColor: '#ddd', margin: '0 2px' }} />
      <button
        aria-label="Delete note"
        title="Delete note"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        style={{
          width: '24px',
          height: '24px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          backgroundColor: '#fff',
          cursor: 'pointer',
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
        data-testid="delete-note-btn"
      >
        🗑
      </button>
    </div>
  );
}
