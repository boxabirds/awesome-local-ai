/**
 * TextToolbar (story 9): S, M, L, XL size buttons and Delete.
 * Appears above a selected text object.
 */
import type { JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

const SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[];

export interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

export function TextToolbar(props: TextToolbarProps): JSX.Element {
  return (
    <div
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 4px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        border: '1px solid #ddd',
        borderRadius: 4,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        whiteSpace: 'nowrap',
        fontSize: 12,
      }}
    >
      {SIZE_KEYS.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={`Size ${s}`}
          aria-pressed={s === props.size}
          data-testid={`text-size-${s}`}
          style={{
            padding: '2px 6px',
            border: '1px solid #ccc',
            borderRadius: 3,
            background: s === props.size ? '#4285F4' : '#fff',
            color: s === props.size ? '#fff' : '#333',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: s === props.size ? 'bold' : 'normal',
          }}
          onClick={() => props.onSize(s)}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete"
        data-testid="text-delete"
        style={{
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          padding: 2,
          display: 'flex',
          alignItems: 'center',
          marginLeft: 4,
        }}
        onClick={props.onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M3 4h8M5.5 4V2.5h3V4M4 4l.5 7.5h5L10 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}