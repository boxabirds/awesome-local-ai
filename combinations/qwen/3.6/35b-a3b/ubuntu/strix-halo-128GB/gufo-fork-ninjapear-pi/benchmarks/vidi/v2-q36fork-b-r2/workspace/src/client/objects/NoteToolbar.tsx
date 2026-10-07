import * as React from 'react';
import { STICKY_COLORS } from '../../shared/config';
import type { StickyColor } from '../../shared/config';

interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

export function NoteToolbar(props: NoteToolbarProps): React.JSX.Element {
  const { color, onColor, onDelete } = props;

  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Sticky note toolbar"
      style={{
        position: 'absolute',
        top: -40,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '2px',
        padding: '3px',
        background: '#fff',
        borderRadius: '6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
        alignItems: 'center',
      }}
    >
      {COLORS.map((c) => (
        <button
          key={c}
          className={`color-swatches--${c}`}
          onClick={(e) => {
            e.stopPropagation();
            onColor(c);
          }}
          aria-label={`${c.charAt(0).toUpperCase() + c.slice(1)} colour`}
          aria-pressed={color === c}
          title={`${c.charAt(0).toUpperCase() + c.slice(1)} colour`}
          style={{
            width: '24px',
            height: '24px',
            border: color === c ? '2px solid #1a73e8' : `2px solid ${STICKY_COLORS[c]}`,
            borderRadius: '4px',
            backgroundColor: STICKY_COLORS[c],
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
          }}
        />
      ))}
      <div style={{ width: '1px', height: '20px', background: '#ccc', margin: '0 2px', flexShrink: 0 }} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="Delete note"
        title="Delete note"
        style={{
          width: '24px',
          height: '24px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          fontSize: '14px',
          color: '#666',
        }}
      >
        🗑
      </button>
    </div>
  );
}
