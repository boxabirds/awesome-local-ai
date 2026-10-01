import React from 'react';
import type { TextSize } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

/**
 * Floating toolbar for a selected text object: four size buttons and a Delete button.
 */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps) {
  return (
    <div
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text actions"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 4,
        boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={`Size ${s}`}
          title={`Size ${s}`}
          aria-pressed={s === size}
          data-testid={`text-size-${s}`}
          onClick={() => onSize(s)}
          style={{
            width: 28,
            height: 28,
            padding: 0,
            border: s === size ? '2px solid #1976D2' : '1px solid rgba(0,0,0,0.25)',
            borderRadius: 6,
            backgroundColor: s === size ? '#E3F2FD' : '#fff',
            color: '#333',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: s === size ? 700 : 400,
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
