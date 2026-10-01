import { TEXT_SIZES, type TextSize } from '../../shared/config';

const SIZE_NAMES = Object.keys(TEXT_SIZES) as TextSize[];

export function TextToolbar(props: { size: TextSize; onSize(s: TextSize): void; onDelete(): void }) {
  return (
    <div
      className="note-toolbar text-toolbar"
      role="toolbar"
      aria-label="Text tools"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {SIZE_NAMES.map((s) => (
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
        </svg>
      </button>
    </div>
  );
}
