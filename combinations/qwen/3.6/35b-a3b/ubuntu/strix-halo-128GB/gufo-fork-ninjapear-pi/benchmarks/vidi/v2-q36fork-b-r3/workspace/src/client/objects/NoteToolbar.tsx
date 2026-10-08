import React from 'react';
import { STICKY_COLORS } from '@shared/config';
import type { StickyColor } from '@shared/config';

interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
  onBoundary?(): void;
}

export function NoteToolbar({ color, onColor, onDelete, onBoundary }: NoteToolbarProps) {
  const colours = Object.entries(STICKY_COLORS);

  return (
    <div
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
      onClick={(e) => e.stopPropagation()}
    >
      {colours.map(([name, hex]) => (
        <button
          key={name}
          aria-label={`${name} colour`}
          aria-pressed={color === name}
          title={`${name} colour`}
          onClick={(e) => {
            e.stopPropagation();
            onBoundary?.();
            onColor(name as StickyColor);
          }}
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: hex,
            border: color === name ? '2px solid #333' : '1px solid rgba(0,0,0,0.2)',
            cursor: 'pointer',
            padding: 0,
          }}
        />
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
        aria-label="Delete note"
        title="Delete note"
        onClick={(e) => {
          e.stopPropagation();
          onBoundary?.();
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
