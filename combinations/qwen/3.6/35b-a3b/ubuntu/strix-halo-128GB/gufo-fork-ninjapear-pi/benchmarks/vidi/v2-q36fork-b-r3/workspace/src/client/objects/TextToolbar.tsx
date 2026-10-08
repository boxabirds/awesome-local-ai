import React from 'react';
import type { TextSize } from '@shared/config';
import { TEXT_SIZES } from '@shared/config';

interface TextToolbarProps {
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

const SIZE_LABELS: Record<TextSize, string> = {
  S: 'S',
  M: 'M',
  L: 'L',
  XL: 'XL',
};

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        padding: '4px 6px',
        borderRadius: 16,
        background: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 90,
      }}
    >
      {(Object.keys(TEXT_SIZES) as TextSize[]).map((s) => (
        <button
          key={s}
          aria-label={`Text size ${s}`}
          aria-pressed={size === s}
          title={`Size ${s} (${TEXT_SIZES[s]} board units)`}
          onClick={(e) => {
            e.stopPropagation();
            onSize(s);
          }}
          style={{
            width: 24,
            height: 24,
            border: size === s ? '2px solid #333' : '1px solid rgba(0,0,0,0.2)',
            borderRadius: 4,
            background: '#fff',
            cursor: 'pointer',
            fontSize: `${TEXT_SIZES[s] * 0.7}px`,
            fontWeight: size === s ? 700 : 400,
            color: '#333',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {SIZE_LABELS[s]}
        </button>
      ))}
      <div
        style={{
          width: 1,
          height: 20,
          background: '#ddd',
          margin: '0 2px',
        }}
      />
      <button
        aria-label="Delete text"
        title="Delete text"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        style={{
          width: 20,
          height: 20,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          color: '#c44',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        🗑
      </button>
    </div>
  );
}
