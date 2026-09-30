import type { ReactElement } from 'react';
import type { TextSize } from '../../shared/objects/text';

interface TextToolbarProps {
  currentSize: TextSize;
  onSizeChange(size: TextSize): void;
  onDelete(): void;
}

const SIZES: TextSize[] = ['S', 'M', 'L'];

/**
 * Per-selection toolbar for text objects (story 9). Three size buttons
 * (S/M/L) with an active state, and a delete button. Rendered in the
 * selection bar above the selection box.
 */
export function TextToolbar({ currentSize, onSizeChange, onDelete }: TextToolbarProps): ReactElement {
  return (
    <div
      data-testid="text-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: '#ffffff',
        border: '1px solid #d1d5db',
        borderRadius: 6,
        padding: 4,
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          data-testid={`text-size-${s}`}
          aria-label={`Text size ${s}`}
          aria-pressed={currentSize === s}
          onClick={() => onSizeChange(s)}
          style={{
            fontSize: s === 'S' ? 11 : s === 'M' ? 13 : 15,
            minWidth: 24,
            height: 24,
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            background: currentSize === s ? '#2563eb' : '#ffffff',
            color: currentSize === s ? '#ffffff' : '#111827',
            cursor: 'pointer',
          }}
        >
          A
        </button>
      ))}
      <span style={{ width: 1, height: 20, background: '#e5e7eb' }} />
      <button
        type="button"
        data-testid="text-delete"
        aria-label="Delete text"
        onClick={onDelete}
        style={{
          fontSize: 14,
          minWidth: 24,
          height: 24,
          border: '1px solid #e5e7eb',
          borderRadius: 4,
          background: '#ffffff',
          color: '#dc2626',
          cursor: 'pointer',
        }}
      >
        🗑
      </button>
    </div>
  );
}
