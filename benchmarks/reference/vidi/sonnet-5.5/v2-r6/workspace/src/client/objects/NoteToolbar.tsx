import type { PointerEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

const stop = (e: PointerEvent) => e.stopPropagation();

const label = (c: string) => `${c[0].toUpperCase()}${c.slice(1)}`;

export function NoteToolbar(props: {
  color: StickyColor; onColor(c: StickyColor): void; onDelete(): void;
}) {
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Note toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="note-swatch"
          aria-label={`${label(c)} colour`}
          title={`${label(c)} colour`}
          aria-pressed={props.color === c}
          style={{ background: STICKY_COLORS[c] }}
          onClick={() => props.onColor(c)}
        />
      ))}
      <button
        type="button"
        className="note-delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={props.onDelete}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 7h12M9 7V5h6v2m-8 0 1 12h8l1-12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
