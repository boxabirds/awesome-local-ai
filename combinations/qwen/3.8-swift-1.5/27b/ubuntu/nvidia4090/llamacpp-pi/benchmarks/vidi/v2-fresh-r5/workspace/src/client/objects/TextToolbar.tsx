/**
 * Text toolbar (story 9): S/M/L/XL size buttons + Delete.
 * Shown when exactly one text object is selected.
 */
import type { JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

interface TextToolbarProps {
  size: TextSize;
  onSize: (s: TextSize) => void;
  onDelete: () => void;
}

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

export function TextToolbar(props: TextToolbarProps): JSX.Element {
  const { size, onSize, onDelete } = props;

  return (
    <div
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text toolbar"
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
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={`Size ${s}`}
          aria-pressed={size === s}
          data-testid={`text-size-${s.toLowerCase()}`}
          onClick={() => onSize(s)}
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '4px',
            border: size === s ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.2)',
            background: size === s ? '#E8F0FE' : 'white',
            cursor: 'pointer',
            fontSize: `${Math.max(10, TEXT_SIZES[s] / 2)}px`,
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
      <div style={{ width: '1px', height: '20px', background: 'rgba(0,0,0,0.15)', margin: '0 4px' }} />
      <button
        type="button"
        aria-label="Delete text"
        data-testid="text-delete-btn"
        onClick={onDelete}
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '4px',
          border: '1px solid rgba(0,0,0,0.2)',
          background: 'white',
          cursor: 'pointer',
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        🗑
      </button>
    </div>
  );
}
