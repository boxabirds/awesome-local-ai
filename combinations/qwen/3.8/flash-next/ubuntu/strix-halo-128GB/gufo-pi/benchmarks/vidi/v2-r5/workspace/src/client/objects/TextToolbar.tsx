import { TEXT_SIZES, type TextSize } from '../../shared/config';

export interface TextToolbarProps {
  size: TextSize;
  onSize(s: TextSize): void;
  onDelete(): void;
}

const SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[];

/**
 * Text toolbar: S/M/L/XL size buttons and a Delete button.
 * Shown when exactly one text object is selected.
 */
export function TextToolbar({ size, onSize, onDelete }: TextToolbarProps) {
  return (
    <div
      className="text-toolbar"
      data-testid="text-toolbar"
      role="toolbar"
      aria-label="Text tools"
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: '#fff',
        borderRadius: 4,
        padding: '2px 6px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        marginBottom: 4,
        zIndex: 10,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {SIZE_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          data-testid={`text-size-${key}`}
          aria-label={`Size ${key}`}
          aria-pressed={size === key}
          onClick={() => onSize(key)}
          style={{
            background: size === key ? '#1976D2' : 'transparent',
            color: size === key ? '#fff' : '#333',
            border: '1px solid #ccc',
            borderRadius: 3,
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          {key}
        </button>
      ))}
      <button
        type="button"
        data-testid="text-toolbar-delete"
        aria-label="Delete text"
        onClick={onDelete}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 3,
          display: 'flex',
          alignItems: 'center',
          color: '#d32f2f',
          marginLeft: 4,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 2h4l.6 1H13v1.5H3V3h2.4L6 2Zm-1 4h1.2l.3 6.2h-1.2L5 6Zm3.4 0h1.2v6.2H8.4V6Zm2.4 0H11l-.3 6.2h-1.2L10.8 6ZM4 13.5h8V15H4v-1.5Z"
          />
        </svg>
      </button>
    </div>
  );
}
