/**
 * Text toolbar (story 9): the four size presets and a delete button, shown
 * while exactly one text object is selected. Sizes are announced by name so
 * they are not distinguished by glyph size alone.
 */
import React from 'react';
import { TEXT_SIZES } from '../../shared/config';
import type { TextSize } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

const SIZE_ORDER: TextSize[] = ['S', 'M', 'L', 'XL'];

const SIZE_NAMES: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

/** Accessible name of a size button, e.g. "Extra large text size". */
export function textSizeLabel(size: TextSize): string {
  return `${SIZE_NAMES[size]} text size`;
}

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
      {SIZE_ORDER.map((name) => {
        const label = textSizeLabel(name);
        const active = name === size;
        return (
          <button
            key={name}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={active}
            data-testid={`text-size-${name}`}
            onClick={() => onSize(name)}
            style={{
              minWidth: 26,
              height: 24,
              padding: '0 4px',
              border: active ? '2px solid #1976D2' : '1px solid rgba(0,0,0,0.2)',
              borderRadius: 6,
              backgroundColor: active ? '#E3F2FD' : '#fff',
              color: '#1f1f1f',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: active ? 700 : 400,
              // The glyph previews the size, clamped so the toolbar stays usable.
              fontSize: Math.min(16, Math.max(10, TEXT_SIZES[name] / 2.4)),
              lineHeight: 1,
            }}
          >
            {name}
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
