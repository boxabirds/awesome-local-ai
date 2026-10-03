// Floating toolbar for a selected text object (story 9): size S/M/L/XL + delete.

import { useCallback, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { TextSize } from '../../shared/config';

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

interface TextToolbarProps {
  size: TextSize;
  onSize: (s: TextSize) => void;
  onDelete: () => void;
}

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps) {
  const stopPointer = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation();
  }, []);
  const stopMouse = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      data-testid="text-toolbar"
      className="text-toolbar"
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
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={`Text size ${s}`}
          aria-pressed={size === s}
          data-testid={`text-size-${s}`}
          onClick={() => onSize(s)}
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: size === s ? '#E3F2FD' : 'transparent',
            boxShadow: size === s ? 'inset 0 0 0 1px #1976D2' : 'none',
            cursor: 'pointer',
            fontSize: '12px',
            color: size === s ? '#1976D2' : '#555',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete text"
        data-testid="text-delete-btn"
        onClick={onDelete}
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '4px',
          border: 'none',
          backgroundColor: 'transparent',
          cursor: 'pointer',
          fontSize: '16px',
          marginLeft: '4px',
        }}
      >
        🗑
      </button>
    </div>
  );
}
