import type { ReactElement } from 'react';
import { TEXT_SIZES, type TextSize } from '@shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

const SIZE_KEYS: TextSize[] = ['S', 'M', 'L', 'XL'];

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): ReactElement {
  return (
    <div
      className="text-toolbar"
      data-board-ui="true"
      data-testid="text-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {SIZE_KEYS.map((key) => (
        <button
          key={key}
          aria-label={`Size ${key}`}
          aria-pressed={key === size}
          className="text-toolbar-size-btn"
          title={`Size ${key} (${TEXT_SIZES[key]}px)`}
          onClick={() => onSize(key)}
          data-testid={`text-size-${key}`}
        >
          {key}
        </button>
      ))}
      <button
        aria-label="Delete text"
        className="text-toolbar-delete"
        title="Delete text"
        onClick={onDelete}
        data-testid="delete-text-btn"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
