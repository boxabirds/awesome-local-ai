/**
 * Text toolbar (story 9, text.size).
 *
 * Screen-space bar above a single selected text object: size presets
 * (S/M/L/XL, each announcing its size) and Delete.
 */

import type { JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

const SIZES = Object.keys(TEXT_SIZES) as TextSize[];

interface TextToolbarProps {
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): JSX.Element {
  return (
    <div
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text options"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: 0,
        top: -44,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 6px',
        backgroundColor: 'white',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        zIndex: 1000,
        fontSize: 13,
        pointerEvents: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          data-testid={`text-size-${s}`}
          aria-label={`Text size ${s}`}
          aria-pressed={size === s}
          onClick={() => onSize(s)}
          style={{
            border: 'none',
            borderRadius: 6,
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: 13,
            backgroundColor: size === s ? '#e8f0fe' : 'transparent',
            color: size === s ? '#1a73e8' : '#333',
            fontWeight: size === s ? 600 : 400,
          }}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        data-testid="delete-text-btn"
        aria-label="Delete text"
        onClick={onDelete}
        style={{
          border: 'none',
          backgroundColor: '#fce8e6',
          color: '#c5221f',
          borderRadius: 6,
          padding: '4px 10px',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        Delete
      </button>
    </div>
  );
}
