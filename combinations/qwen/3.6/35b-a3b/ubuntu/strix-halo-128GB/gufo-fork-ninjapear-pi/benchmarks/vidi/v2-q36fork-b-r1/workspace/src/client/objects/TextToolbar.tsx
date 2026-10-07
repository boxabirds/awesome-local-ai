import type { ReactNode } from 'react';
import type { TextSize } from '@/shared/config';
import { TEXT_SIZES, DEFAULT_TEXT_SIZE } from '@/shared/config';

interface TextToolbarProps {
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

/**
 * Toolbar shown when exactly one text object is selected.
 * Size buttons S/M/L/XL with aria-pressed, and Delete.
 */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): ReactNode {
  const sizes: TextSize[] = ['S', 'M', 'L', 'XL'];

  return (
    <div
      data-testid="text-toolbar"
      style={{
        position: 'fixed',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 8px',
        backgroundColor: '#fff',
        borderRadius: '6px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        zIndex: 100,
        border: '1px solid #e0e0e0',
      }}
    >
      {sizes.map((s) => (
        <button
          key={s}
          aria-label={`Size ${s}`}
          aria-pressed={size === s}
          onClick={(e) => {
            e.stopPropagation();
            onSize(s);
          }}
          title={`Text size ${s} (${TEXT_SIZES[s]}px)`}
          style={{
            width: '32px',
            height: '28px',
            border: size === s ? '2px solid #2979ff' : '1px solid #ccc',
            borderRadius: '4px',
            backgroundColor: size === s ? '#2979ff' : '#f5f5f5',
            color: size === s ? '#fff' : '#333',
            cursor: 'pointer',
            fontSize: `${Math.min(TEXT_SIZES[s], 14)}px`,
            fontWeight: size === s ? 700 : 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
          data-testid={`text-size-${s}`}
        >
          {s}
        </button>
      ))}
      <button
        aria-label="Delete text"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete text"
        style={{
          width: '28px',
          height: '28px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          backgroundColor: '#f5f5f5',
          cursor: 'pointer',
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          marginLeft: '4px',
        }}
        data-testid="delete-text-btn"
      >
        🗑
      </button>
    </div>
  );
}
