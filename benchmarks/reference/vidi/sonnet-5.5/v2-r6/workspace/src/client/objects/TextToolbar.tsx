import type { PointerEvent } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';

const stop = (e: PointerEvent) => e.stopPropagation();

export function TextToolbar(props: { size: TextSize; onSize(s: TextSize): void; onDelete(): void }) {
  return (
    <div
      className="note-toolbar text-toolbar"
      role="toolbar"
      aria-label="Text toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {(Object.keys(TEXT_SIZES) as TextSize[]).map((s) => (
        <button
          key={s}
          type="button"
          className="text-size"
          title={`Text size ${s}`}
          aria-pressed={props.size === s}
          onClick={() => props.onSize(s)}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        className="note-delete"
        aria-label="Delete text"
        title="Delete text"
        onClick={props.onDelete}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 7h12M9 7V5h6v2m-8 0 1 12h8l1-12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
