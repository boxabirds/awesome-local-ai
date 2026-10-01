/**
 * TextToolbar: S/M/L/XL size buttons and Delete for a selected text object.
 */
import { TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

const SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[];

export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps): React.JSX.Element {
  return (
    <div
      className="text-toolbar"
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text formatting"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        background: 'var(--chrome-bg)',
        border: '1px solid var(--chrome-border)',
        borderRadius: 6,
        boxShadow: '0 1px 3px rgb(0 0 0 / 12%)',
        fontSize: 13,
        whiteSpace: 'nowrap',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {SIZE_KEYS.map((s) => (
        <button
          key={s}
          type="button"
          className="text-toolbar-size-btn"
          data-testid={`text-size-${s}`}
          aria-label={`Size ${s}`}
          aria-pressed={size === s}
          style={{
            width: 28,
            height: 24,
            display: 'grid',
            placeItems: 'center',
            border: size === s ? '1.5px solid var(--selection-blue)' : '1px solid transparent',
            borderRadius: 4,
            background: size === s ? 'var(--selection-blue-alpha, #e3f2fd)' : 'transparent',
            cursor: 'pointer',
            fontWeight: size === s ? 700 : 400,
            fontSize: 12,
            color: 'var(--chrome-text)',
          }}
          onClick={(e) => {
            e.stopPropagation();
            onSize(s);
          }}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete text"
        data-testid="text-delete"
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 24,
          height: 24,
          padding: 0,
          border: '1px solid transparent',
          borderRadius: 4,
          background: 'transparent',
          cursor: 'pointer',
          color: 'var(--chrome-text)',
          marginLeft: 4,
        }}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M6 2h4l.5 1H13v1.5H3V3h2.5L6 2Zm-1.5 4h7L11 14.5H5L4.5 6Z" />
        </svg>
      </button>
    </div>
  );
}
