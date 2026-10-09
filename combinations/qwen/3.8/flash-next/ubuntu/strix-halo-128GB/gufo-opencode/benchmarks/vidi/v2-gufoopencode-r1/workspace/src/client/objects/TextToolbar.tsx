import type { CSSProperties, JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

const barStyle: CSSProperties = {
  // Anchored to a zero-height anchor div at the object's top edge; absolute
  // positioning grows the bar upward so it never covers (or blocks clicks
  // on) the text itself.
  position: 'absolute',
  bottom: 2,
  left: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  background: '#ffffff',
  border: '1px solid #d6dae1',
  borderRadius: 8,
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.18)',
  whiteSpace: 'nowrap',
  pointerEvents: 'auto'
};

const sizeStyle: CSSProperties = {
  height: 22,
  minWidth: 24,
  padding: '0 4px',
  border: '1px solid #d6dae1',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 12
};

const activeStyle: CSSProperties = { ...sizeStyle, background: '#2563eb', borderColor: '#2563eb', color: '#fff' };

const deleteStyle: CSSProperties = {
  height: 22,
  minWidth: 26,
  padding: '0 4px',
  border: '1px solid #d6dae1',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: 1
};

export interface TextToolbarProps {
  size: TextSize;
  onSize(size: TextSize): void;
  onDelete(): void;
}

// The bar above a single selected text object: font size S/M/L/XL + delete
// (design text.render).
export function TextToolbar(props: TextToolbarProps): JSX.Element {
  return (
    <div
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text tools"
      style={barStyle}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      {SIZES.map((size) => (
        <button
          key={size}
          type="button"
          aria-label={`Text size ${size}`}
          title={`Text size ${size} (${TEXT_SIZES[size]}px)`}
          aria-pressed={props.size === size}
          style={props.size === size ? activeStyle : sizeStyle}
          onClick={() => {
            props.onSize(size);
          }}
        >
          {size}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete text"
        title="Delete text"
        style={deleteStyle}
        onClick={() => {
          props.onDelete();
        }}
      >
        🗑
      </button>
    </div>
  );
}
