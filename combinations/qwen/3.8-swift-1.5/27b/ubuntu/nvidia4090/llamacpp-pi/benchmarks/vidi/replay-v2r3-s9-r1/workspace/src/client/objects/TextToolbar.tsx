import type { TextSize } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize: (s: TextSize) => void;
  onDelete: () => void;
}

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

/**
 * Story 9 (text.object): toolbar shown when exactly one text object is
 * selected. Shows S/M/L/XL size buttons (current one highlighted) and Delete.
 */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): React.ReactElement {
  return (
    <div
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text options"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(255,255,255,0.97)',
        border: '1px solid #c8c8c8',
        borderRadius: 8,
        padding: '6px 10px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        fontSize: 13,
        fontFamily: 'system-ui, sans-serif',
        color: '#333',
        userSelect: 'none',
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
            border: size === s ? '2px solid #1565C0' : '1px solid #cfcfcf',
            borderRadius: 4,
            background: size === s ? '#E3F2FD' : '#fff',
            cursor: 'pointer',
            padding: '2px 6px',
            fontSize: s === 'S' ? 11 : s === 'M' ? 13 : s === 'L' ? 15 : 17,
            fontWeight: 'bold',
            lineHeight: 1.2,
          }}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete text"
        title="Delete text (Del)"
        onClick={onDelete}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
          marginLeft: 4,
        }}
      >
        <span aria-hidden>🗑</span>
      </button>
    </div>
  );
}
