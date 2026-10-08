import * as React from 'react';
import { TEXT_SIZES } from '../../shared/config';
import type { TextSize } from '../../shared/config';

interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

export function TextToolbar(props: TextToolbarProps): React.JSX.Element {
  const { size, onSize, onDelete } = props;

  return (
    <div
      style={{
        position: 'absolute',
        top: -36,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '2px',
        padding: '2px 4px',
        background: '#fff',
        borderRadius: '6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
        alignItems: 'center',
      }}
      role="toolbar"
      aria-label="Text toolbar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          onClick={(e) => {
            e.stopPropagation();
            onSize(s);
          }}
          aria-label={`Size ${s}`}
          aria-pressed={size === s}
          title={`Size ${s} (${TEXT_SIZES[s]}px)`}
          style={{
            width: '28px',
            height: '28px',
            border: size === s ? '2px solid #1a73e8' : '1px solid #ccc',
            borderRadius: '4px',
            background: size === s ? '#e8f0fe' : '#fff',
            cursor: 'pointer',
            fontSize: `${Math.min(TEXT_SIZES[s], 20)}px`,
            fontFamily: 'Inter, system-ui, sans-serif',
            fontWeight: 600,
            color: '#333',
            padding: 0,
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          {s}
        </button>
      ))}
      <div style={{ width: '1px', height: '20px', background: '#ccc', margin: '0 2px', flexShrink: 0 }} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="Delete text"
        title="Delete text"
        style={{
          width: '28px',
          height: '28px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          fontSize: '14px',
          color: '#666',
          borderRadius: '4px',
        }}
        onMouseOver={(e) => { (e.target as HTMLElement).style.background = '#fee'; }}
        onMouseOut={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
      >
        🗑
      </button>
    </div>
  );
}
