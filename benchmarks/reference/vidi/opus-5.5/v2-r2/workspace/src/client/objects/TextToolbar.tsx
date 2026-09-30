import { TEXT_SIZES, type TextSize } from '../../shared/config';

const SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[];

const SIZE_NAMES: Record<TextSize, string> = { S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra large' };

/** Floating toolbar for one selected text object: S, M, L, XL sizes and Delete. */
export function TextToolbar(props: { size: TextSize; onSize(s: TextSize): void; onDelete(): void }): React.JSX.Element {
  return (
    <div
      className="note-toolbar text-toolbar"
      role="toolbar"
      aria-label="Text"
      // Clicks here must never reach the board or the text (clear selection, drag, edit).
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {SIZE_KEYS.map((size) => (
        <button
          key={size}
          type="button"
          className="text-toolbar-size"
          aria-label={`Size ${size}`}
          title={`${SIZE_NAMES[size]} (${size})`}
          aria-pressed={props.size === size}
          data-size={size}
          onClick={() => props.onSize(size)}
        >
          {size}
        </button>
      ))}
      <span className="note-toolbar-divider" aria-hidden="true" />
      <button type="button" className="note-toolbar-delete" aria-label="Delete text" title="Delete text" onClick={props.onDelete}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h1.5v-8H10Zm3.5 0v8H15v-8h-1.5Z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}
