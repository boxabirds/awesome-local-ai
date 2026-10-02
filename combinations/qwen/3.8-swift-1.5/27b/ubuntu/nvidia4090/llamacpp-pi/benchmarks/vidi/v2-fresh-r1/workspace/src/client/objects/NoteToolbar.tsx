// Floating toolbar for a selected sticky note: colour swatches + delete.

import { useCallback, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

interface NoteToolbarProps {
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

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  const stopPointer = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation();
  }, []);
  const stopMouse = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      data-testid="note-toolbar"
      className="note-toolbar"
      style={{
        position: 'absolute',
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        marginBottom: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 8px',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        whiteSpace: 'nowrap',
        zIndex: 10,
      }}
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      onPointerMove={stopPointer}
      onDoubleClick={stopMouse}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${COLOR_NAMES[c]} colour`}
          aria-pressed={color === c}
          data-testid={`swatch-${c}`}
          onClick={() => onColor(c)}
          style={{
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            border: color === c ? '2px solid #333' : '2px solid transparent',
            backgroundColor: STICKY_COLORS[c],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        data-testid="delete-note-btn"
        onClick={onDelete}
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '4px',
          border: 'none',
          backgroundColor: 'transparent',
          cursor: 'pointer',
          fontSize: '16px',
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
