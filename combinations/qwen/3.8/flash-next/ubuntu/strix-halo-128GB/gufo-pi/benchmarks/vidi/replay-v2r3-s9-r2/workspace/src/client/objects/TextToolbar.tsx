import React from 'react';
import type { TextSize } from '../../shared/config';
import { TEXT_SIZES } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

const SIZE_ORDER = Object.keys(TEXT_SIZES) as TextSize[];

const SIZE_NAMES: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

/**
 * Floating toolbar of a single selected text object: the four size presets and a
 * bin button. The preset key is shown on the button and the full name in its
 * accessible label and tooltip.
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
        gap: 2,
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 4,
        boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {SIZE_ORDER.map((key) => {
        const label = `${SIZE_NAMES[key]} text (${key})`;
        const active = key === size;
        return (
          <button
            key={key}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={active}
            data-testid={`text-size-${key}`}
            onClick={() => onSize(key)}
            style={{
              minWidth: 26,
              height: 24,
              padding: '0 5px',
              border: 'none',
              borderRadius: 6,
              backgroundColor: active ? '#D9E2F8' : 'transparent',
              color: '#3c4043',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: active ? 700 : 500,
              fontSize: 13,
              lineHeight: '24px',
            }}
          >
            {key}
          </button>
        );
      })}
      <button
        type="button"
        aria-label="Delete text"
        title="Delete text"
        data-testid="delete-text-button"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          padding: 0,
          marginLeft: 2,
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
