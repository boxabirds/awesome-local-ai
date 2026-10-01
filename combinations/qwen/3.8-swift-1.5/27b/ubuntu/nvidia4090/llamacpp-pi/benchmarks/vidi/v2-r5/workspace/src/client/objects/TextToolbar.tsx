// src/client/objects/TextToolbar.tsx
// Size buttons (S/M/L/XL) + Delete for a single selected text object.

import type { ReactElement } from 'react';
import { type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize: (s: TextSize) => void;
  onDelete: () => void;
}

const SIZE_ORDER: TextSize[] = ['S', 'M', 'L', 'XL'];

export function TextToolbar(props: TextToolbarProps): ReactElement {
  const { size, onSize, onDelete } = props;

  return (
    <div
      data-testid="text-toolbar"
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
      {SIZE_ORDER.map((s) => (
        <button
          key={s}
          aria-label={`Size ${s}`}
          aria-pressed={size === s}
          data-testid={`text-size-${s}`}
          onClick={() => onSize(s)}
          style={{
            width: 28,
            height: 24,
            border: '1px solid #ccc',
            borderRadius: 4,
            background: size === s ? '#BBDEFB' : 'white',
            cursor: 'pointer',
            fontSize: s === 'XL' ? 14 : s === 'L' ? 12 : s === 'M' ? 11 : 10,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          {s}
        </button>
      ))}
      <button
        aria-label="Delete text"
        data-testid="text-delete-btn"
        onClick={onDelete}
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
          padding: 0,
          marginLeft: 4,
        }}
      >
        🗑
      </button>
    </div>
  );
}
