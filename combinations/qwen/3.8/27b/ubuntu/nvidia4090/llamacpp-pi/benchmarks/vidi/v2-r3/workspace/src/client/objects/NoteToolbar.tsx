import type { ReactElement } from 'react';
import type { StickyColor } from '../../shared/config';
import { STICKY_COLORS } from '../../shared/config';

/**
 * Floating toolbar for the selected note: six colour swatches + delete.
 * Rendered inside the note (counter-scaled by the parent) so it stays above
 * the note in screen space without scaling with zoom.
 */
export function NoteToolbar(props: {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}): ReactElement {
  return (
    <div
      className="note-toolbar"
      style={{
        position: 'absolute',
        top: -46,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: '#fff',
        border: '1px solid #d5d9e0',
        borderRadius: 8,
        padding: '4px 6px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        zIndex: 10,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${c.charAt(0).toUpperCase() + c.slice(1)} colour`}
          title={c}
          aria-pressed={props.color === c}
          onClick={() => props.onColor(c)}
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            border: props.color === c ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.2)',
            background: STICKY_COLORS[c],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        onClick={props.onDelete}
        style={{
          width: 22,
          height: 22,
          border: '1px solid #d5d9e0',
          borderRadius: 4,
          background: '#fff',
          cursor: 'pointer',
          fontSize: 13,
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}
