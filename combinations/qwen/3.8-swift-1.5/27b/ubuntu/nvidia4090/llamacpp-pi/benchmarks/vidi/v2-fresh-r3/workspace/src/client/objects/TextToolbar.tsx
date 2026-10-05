import type { JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

export interface TextToolbarProps {
  /** The text object's current size preset (the pressed button). */
  size: TextSize;
  /** Change the size (the board wraps this in undo boundaries). */
  onSize(s: TextSize): void;
  onDelete(): void;
}

/**
 * The toolbar for a single selected text object (story 9, text.editor):
 * size presets S / M / L / XL (`aria-label="Size S"`…, `aria-pressed` on the
 * current one) and a Delete button. Replaces the sticky NoteToolbar when the
 * selection is exactly one text object (SelectionBar).
 */
export function TextToolbar(props: TextToolbarProps): JSX.Element {
  const { size, onSize, onDelete } = props;
  return (
    <div
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: '4px 6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      }}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          data-testid={`text-size-${s}`}
          aria-label={`Size ${s}`}
          aria-pressed={size === s}
          title={`Size ${s}`}
          onClick={() => onSize(s)}
          style={{
            border: 'none',
            background: size === s ? '#E8F0FE' : 'transparent',
            cursor: 'pointer',
            padding: '2px 6px',
            borderRadius: 4,
            fontWeight: 700,
            fontFamily: 'Georgia, serif',
            fontSize: Math.min(10 + TEXT_SIZES[s] / 4, 20),
            lineHeight: 1.4,
            color: size === s ? '#1A73E8' : '#333',
          }}
        >
          {s}
        </button>
      ))}
      <span style={{ width: 1, height: 18, background: '#ddd', margin: '0 3px' }} />
      <button
        type="button"
        data-testid="delete-text-button"
        aria-label="Delete text"
        title="Delete text"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          padding: 0,
          border: 'none',
          borderRadius: 4,
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        🗑️
      </button>
    </div>
  );
}
