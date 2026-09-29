import React from 'react';
import { TextSize, TEXT_SIZES } from '@shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

const SIZE_LABELS: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps) {
  return (
    <div
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text options"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: 'rgba(255,255,255,0.95)',
        borderRadius: '6px',
        padding: '4px 6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        height: '32px',
      }}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={`${SIZE_LABELS[s]} (${s})`}
          title={`${SIZE_LABELS[s]} text`}
          aria-pressed={s === size}
          data-testid={`text-size-${s}`}
          onClick={() => onSize(s)}
          style={{
            width: '28px',
            height: '24px',
            border: s === size ? '2px solid #1976D2' : '1px solid rgba(0,0,0,0.25)',
            borderRadius: '4px',
            background: s === size ? '#E3F2FD' : 'transparent',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: s === size ? 'bold' : 'normal',
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
        title="Delete text"
        data-testid="delete-text-button"
        onClick={onDelete}
        style={{
          width: '24px',
          height: '24px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: '2px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.6 9h5.8l.6-9M6.5 6.5v4.5M9.5 6.5v4.5"
            fill="none"
            stroke="#444"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
