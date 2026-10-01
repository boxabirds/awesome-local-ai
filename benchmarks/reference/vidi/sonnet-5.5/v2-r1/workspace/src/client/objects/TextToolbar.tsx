import { TEXT_SIZES } from '../../shared/config';
import type { TextSize } from '../../shared/config';

const SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[];

export function TextToolbar(props: { size: TextSize; onSize(s: TextSize): void; onDelete(): void }) {
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Text tools"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {SIZE_KEYS.map((s) => (
        <button
          key={s}
          type="button"
          className="size-button"
          title={`Text size ${s}`}
          aria-pressed={props.size === s}
          onClick={() => props.onSize(s)}
        >
          {s}
        </button>
      ))}
      <button type="button" className="note-delete" aria-label="Delete text" title="Delete text" onClick={props.onDelete}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </svg>
      </button>
    </div>
  );
}
