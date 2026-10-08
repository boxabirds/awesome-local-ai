/**
 * Floating toolbar for one selected text object (story 9, text.object):
 * the four size presets (S/M/L/XL, active one pressed) and a Delete button.
 *
 * Rendered in screen space, centred just above the selected text (by the
 * SelectionBar). It stops pointer/double-click propagation so pressing it
 * never deselects the text, pans the board, or creates anything.
 */
import { type JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  /** The text object's current size preset. */
  size: TextSize;
  /** Change the size preset (the box re-measures automatically). */
  onSize(s: TextSize): void;
  /** Delete the text object. */
  onDelete(): void;
  /** load_failed: size/delete are disabled. */
  disabled?: boolean;
}

const SIZES: readonly TextSize[] = ['S', 'M', 'L', 'XL'];

export function TextToolbar({ size, onSize, onDelete, disabled = false }: TextToolbarProps): JSX.Element {
  return (
    <div
      data-testid="text-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        background: 'rgba(255,255,255,0.96)',
        border: '1px solid #d8d8d0',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.16)',
      }}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={`Text size ${s}`}
          title={disabled ? 'Board unavailable' : `Text size ${s}`}
          aria-pressed={size === s}
          disabled={disabled}
          data-testid={`text-size-${s.toLowerCase()}`}
          onClick={() => onSize(s)}
          style={{
            minWidth: 26,
            height: 24,
            padding: '0 6px',
            fontSize: s === 'XL' ? 12 : 13,
            fontWeight: size === s ? 700 : 400,
            color: TEXT_SIZES[s] >= TEXT_SIZES.L ? '#1a1a17' : '#3c3c34',
            background: size === s ? '#e8f0fe' : 'transparent',
            border: size === s ? '1px solid #1a73e8' : '1px solid transparent',
            borderRadius: 4,
            cursor: 'pointer',
            boxSizing: 'border-box',
          }}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete text"
        title={disabled ? 'Board unavailable' : 'Delete text'}
        disabled={disabled}
        data-testid="text-delete-button"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          display: 'grid',
          placeItems: 'center',
          padding: 0,
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
    </div>
  );
}
