import React from 'react'
import { TEXT_SIZES } from '../../shared/config'
import type { TextSize } from '../../shared/config'

export interface TextToolbarProps {
  size: TextSize
  onSize(s: TextSize): void
  onDelete(): void
}

const SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[]

/**
 * Toolbar shown when exactly one text object is selected (not editing).
 * Provides S/M/L/XL size buttons and a Delete button.
 */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps) {
  return (
    <div
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 6px',
        background: 'rgba(255,255,255,0.95)',
        border: '1px solid rgba(0,0,0,0.15)',
        borderRadius: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        pointerEvents: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      {SIZE_KEYS.map(key => (
        <button
          key={key}
          data-testid={`text-size-${key}`}
          aria-label={`Text size ${key}`}
          aria-pressed={size === key}
          onClick={() => onSize(key)}
          style={{
            width: 28,
            height: 24,
            border: '1px solid rgba(0,0,0,0.2)',
            borderRadius: 4,
            background: size === key ? '#4285f4' : 'transparent',
            color: size === key ? 'white' : 'inherit',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: size === key ? 'bold' : 'normal',
            padding: 0,
            lineHeight: '22px',
          }}
        >
          {key}
        </button>
      ))}
      <button
        data-testid="delete-text-btn"
        aria-label="Delete text"
        onClick={onDelete}
        style={{
          width: 28,
          height: 24,
          border: '1px solid rgba(0,0,0,0.2)',
          borderRadius: 4,
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 14,
          padding: 0,
          lineHeight: '22px',
          color: '#c62828',
        }}
      >
        🗑
      </button>
    </div>
  )
}
