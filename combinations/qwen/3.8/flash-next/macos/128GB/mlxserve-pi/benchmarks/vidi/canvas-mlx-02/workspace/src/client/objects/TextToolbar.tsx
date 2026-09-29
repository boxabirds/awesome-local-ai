// The text object's own toolbar (story 9, text.size_scale).
//
// The four font sizes in one row - S, M, L, XL, the words the design names -
// with the object's current size pressed, and the Delete every selection gets.
// It replaces the selection's generic count bar when exactly one text is
// selected, the same way the sticky note's colour toolbar does, and it does
// nothing no other toolbar does: picking a size changes only the SIZE field
// and asks for nothing about the box, which the layout hook grows inside the
// same undo step.
import type React from 'react';
import { TEXT_SIZES, DEFAULT_TEXT_SIZE } from '../../shared/config.ts';
import type { TextSize } from '../../shared/config.ts';

export interface TextToolbarProps {
  size: TextSize | string;
  /** choose the size for the single selected text object */
  onSize(size: TextSize): void;
  /** remove the whole selection (the model call and the clear are the caller's) */
  onDelete(): void;
}

const SIZES: readonly TextSize[] = ['S', 'M', 'L', 'XL'];

// The size labels read left to right in the order the design gives.
export function TextToolbar(props: TextToolbarProps): React.JSX.Element {
  const { size, onSize, onDelete } = props;
  const current: TextSize = (SIZES as readonly string[]).includes(size)
    ? (size as TextSize)
    : DEFAULT_TEXT_SIZE;

  return (
    <div
      role="toolbar"
      aria-label="Text"
      data-testid="text-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 6px 4px 6px',
        background: '#ffffff',
        border: '1px solid #e2e2e2',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        color: '#202020',
      }}
    >
      {SIZES.map((key) => {
        const active = key === current;
        return (
          <button
            key={key}
            type="button"
            aria-label={`Text size ${key}`}
            title={`Text size ${key} – ${TEXT_SIZES[key]} px`}
            aria-pressed={active}
            data-testid={`text-size-${key}`}
            onClick={() => onSize(key)}
            style={{
              minWidth: 26,
              padding: '2px 4px',
              border: active ? '1px solid #2563eb' : '1px solid #e2e2e2',
              background: active ? '#eef2ff' : '#fafafa',
              borderRadius: 6,
              fontFamily: 'inherit',
              fontWeight: active ? 700 : 400,
              fontSize: 'inherit',
              cursor: 'pointer',
            }}
          >
            {key}
          </button>
        );
      })}
      <span aria-hidden="true" style={{ width: 1, height: 18, margin: '0 2px', background: '#e2e2e2' }} />
      <button
        type="button"
        aria-label="Delete selection"
        onClick={onDelete}
        style={{
          border: '1px solid #e2e2e2',
          background: '#fafafa',
          borderRadius: 6,
          padding: '2px 8px',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          cursor: 'pointer',
        }}
      >
        Delete
      </button>
    </div>
  );
}
