import type { JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '@shared/config';

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

interface TextToolbarProps {
  size: TextSize;
  onSize: (s: TextSize) => void;
  onDelete: () => void;
}

/**
 * Story 9: toolbar for a single selected text (PRD text.size /
 * text.delete): S, M, L, XL size buttons (current one highlighted) and
 * Delete.
 */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): JSX.Element {
  return (
    <div
      data-testid="text-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: '#fff',
        borderRadius: 10,
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        padding: '6px 10px',
      }}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          aria-label={`Size ${s}`}
          aria-pressed={size === s}
          data-testid={`text-size-${s.toLowerCase()}`}
          onClick={() => onSize(s)}
          style={{
            width: 32,
            height: 32,
            border: 'none',
            borderRadius: 6,
            background: size === s ? '#2196F3' : '#F5F5F5',
            color: size === s ? '#fff' : '#333',
            fontSize: `${Math.min(14, 8 + TEXT_SIZES[s] / 6)}px`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {s}
        </button>
      ))}
      <button
        aria-label="Delete text"
        data-testid="delete-text"
        onClick={onDelete}
        style={{
          width: 32,
          height: 32,
          border: 'none',
          borderRadius: 6,
          background: '#FFEBEE',
          color: '#C62828',
          fontSize: 14,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ✕
      </button>
    </div>
  );
}
