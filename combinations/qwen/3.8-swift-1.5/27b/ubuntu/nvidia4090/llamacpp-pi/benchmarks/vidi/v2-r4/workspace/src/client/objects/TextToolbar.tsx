import type { JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

const SIZE_ORDER: TextSize[] = ['S', 'M', 'L', 'XL'];

export interface TextToolbarProps {
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

/**
 * Selection bar for a single text object (story 9, text.object):
 * S/M/L/XL size presets with pressed state, and Delete.
 */
export function TextToolbar(props: TextToolbarProps): JSX.Element {
  const { size, onSize, onDelete } = props;

  return (
    <div
      data-testid="text-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'white',
        border: '1px solid #ddd',
        borderRadius: 6,
        padding: '4px 8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {SIZE_ORDER.map((s) => (
        <button
          key={s}
          aria-label={`Size ${s}`}
          aria-pressed={size === s}
          title={`${s} (${TEXT_SIZES[s]}px)`}
          onClick={() => onSize(s)}
          style={{
            minWidth: 28,
            height: 24,
            borderRadius: 4,
            border: '1px solid #ccc',
            backgroundColor: size === s ? '#2196F3' : 'white',
            color: size === s ? 'white' : '#333',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {s}
        </button>
      ))}
      <button
        aria-label="Delete text"
        title="Delete text"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          borderRadius: 4,
          border: '1px solid #ccc',
          backgroundColor: 'white',
          cursor: 'pointer',
          fontSize: 14,
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
