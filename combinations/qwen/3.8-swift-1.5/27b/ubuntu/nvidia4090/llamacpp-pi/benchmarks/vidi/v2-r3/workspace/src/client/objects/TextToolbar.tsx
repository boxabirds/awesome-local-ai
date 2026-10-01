import {
  TEXT_SIZES,
  type TextSize,
} from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize: (size: TextSize) => void;
  onDelete: () => void;
}

const SIZES = Object.keys(TEXT_SIZES) as TextSize[];

/**
 * The floating toolbar for a selected text object (story 9): the four size
 * presets (S/M/L/XL, `aria-pressed` on the active one) and a delete (bin)
 * button. Rendered in screen space above the selection. Pointer events stop
 * propagation so clicks never clear the selection.
 */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): React.ReactElement {
  return (
    <div
      data-testid="text-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label="Text options"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(255,255,255,0.96)',
        border: '1px solid #c8c8c8',
        borderRadius: 8,
        padding: '6px 8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
      }}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={`Size ${s}`}
          aria-pressed={size === s}
          title={`Size ${s}`}
          onClick={() => onSize(s)}
          style={{
            minWidth: 26,
            height: 26,
            borderRadius: 4,
            border: size === s ? '2px solid #1565C0' : '1px solid rgba(0,0,0,0.2)',
            background: size === s ? 'rgba(21,101,192,0.12)' : 'transparent',
            cursor: 'pointer',
            padding: 0,
            fontSize: s === 'S' ? 11 : s === 'M' ? 13 : s === 'L' ? 15 : 17,
            fontWeight: 600,
            fontFamily: 'system-ui, sans-serif',
            color: '#333',
            flexShrink: 0,
          }}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete text"
        title="Delete text"
        onClick={onDelete}
        style={{
          width: 26,
          height: 26,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
          marginLeft: 2,
        }}
      >
        <span aria-hidden>🗑</span>
      </button>
    </div>
  );
}
