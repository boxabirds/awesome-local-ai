import React from 'react';
import type { TextSize } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

/**
 * Size picker and delete button for a single selected text object.
 */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps) {
  return (
    <div
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text formatting"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#fff',
        borderRadius: 6,
        padding: '4px 6px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={`${s} text size`}
          aria-pressed={s === size ? 'true' : 'false'}
          data-testid={`text-size-${s}`}
          onClick={() => onSize(s)}
          style={{
            width: 28,
            height: 28,
            padding: 0,
            border: s === size ? '1.5px solid #1976D2' : '1px solid #ccc',
            borderRadius: 4,
            backgroundColor: s === size ? '#E3F2FD' : '#fff',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: s === size ? 700 : 400,
            color: '#333',
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
        data-testid="delete-text-button"
        onClick={onDelete}
        style={{
          width: 28,
          height: 28,
          padding: 0,
          border: 'none',
          borderRadius: 6,
          background: 'none',
          color: '#5f6368',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: 4,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3 4h10M6.5 4V2.8h3V4M4.4 4l.6 9.2h6L11.6 4M6.6 6.2v5M9.4 6.2v5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
