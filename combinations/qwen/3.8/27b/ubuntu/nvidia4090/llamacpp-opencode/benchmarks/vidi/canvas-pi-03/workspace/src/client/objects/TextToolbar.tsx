import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import { TEXT_SIZES, type TextSize } from '@/shared/config';

export interface TextToolbarProps {
  /** Current size of the selected text object (drives aria-pressed). */
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

const buttonStyle = (pressed: boolean): React.CSSProperties => ({
  width: 32,
  height: 28,
  padding: 0,
  border: pressed ? '1px solid #1A73E8' : '1px solid transparent',
  borderRadius: 6,
  background: pressed ? '#D2E3FC' : 'transparent',
  color: 'rgba(0, 0, 0, 0.8)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  lineHeight: 1,
});

/**
 * Text toolbar (story 9, text.size): the four size presets (S/M/L/XL, the
 * current one highlighted via aria-pressed) and Delete, shown when exactly
 * one text object is selected. The pointerdown stopPropagation keeps a
 * toolbar press from starting a board gesture (like the sticky toolbar).
 */
export function TextToolbar(props: TextToolbarProps): ReactElement {
  const stopPointer = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.stopPropagation();
  };
  return (
    <div
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text actions"
      onPointerDown={stopPointer}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        background: '#FFFFFF',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        borderRadius: 8,
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.18)',
        userSelect: 'none',
      }}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={`Text size ${s}`}
          title={`Text size ${s}`}
          aria-pressed={props.size === s}
          data-testid={`text-size-${s}`}
          onClick={() => props.onSize(s)}
          style={{
            ...buttonStyle(props.size === s),
            // Visual step between presets so the buttons read S < M < L < XL.
            fontSize: 10 + TEXT_SIZES[s] / 8,
          }}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete text"
        data-testid="delete-text"
        onClick={props.onDelete}
        style={{
          ...buttonStyle(false),
          width: 'auto',
          padding: '0 8px',
          fontSize: 12,
        }}
      >
        Delete
      </button>
    </div>
  );
}
