/**
 * Story 9: the single-text selection toolbar (text.size / text.object).
 *
 * Shown for exactly ONE selected text object (the same floating-bar slot as
 * the story 2 note toolbar): S/M/L/XL size presets (aria-pressed reflects
 * the current size) and Delete. A size change keeps the text's top-left
 * (x, y); the box is remeasured by the board (text.height).
 */
import type { CSSProperties, JSX } from 'react';
import type { TextSize } from 'src/shared/config';

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

export interface TextToolbarProps {
  size: TextSize;
  onSize: (s: TextSize) => void;
  onDelete: () => void;
}

export function TextToolbar(props: TextToolbarProps): JSX.Element {
  return (
    <div
      data-testid="text-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: 6,
        backgroundColor: '#ffffff',
        border: '1px solid #d0d7de',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={`Text size ${s}`}
          aria-pressed={props.size === s}
          data-testid={`text-size-button-${s}`}
          onClick={() => props.onSize(s)}
          style={sizeButtonStyle(props.size === s)}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete text"
        data-testid="text-delete-button"
        onClick={props.onDelete}
        style={sizeButtonStyle(false)}
      >
        Delete
      </button>
    </div>
  );
}

function sizeButtonStyle(active: boolean): CSSProperties {
  return {
    padding: '4px 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: active ? '#D6E4FF' : '#FFFFFF',
    border: `1px solid ${active ? '#1A73E8' : '#d0d7de'}`,
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 700 : 400,
    color: '#333',
  };
}
