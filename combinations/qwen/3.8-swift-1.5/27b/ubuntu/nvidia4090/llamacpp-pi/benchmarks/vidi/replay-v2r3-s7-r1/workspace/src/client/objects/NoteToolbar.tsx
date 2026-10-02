import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor: (c: StickyColor) => void;
  onDelete: () => void;
}

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The floating toolbar for a selected note: six colour swatches and a delete
 * (bin) button. Rendered in screen space above the note (not scaled by zoom).
 * Pointer events stop propagation so clicks never clear the selection.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): React.ReactElement {
  return (
    <div
      data-testid="note-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label="Note options"
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
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${capitalize(c)} colour`}
          aria-pressed={color === c}
          title={`${capitalize(c)} colour`}
          onClick={() => onColor(c)}
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            border: color === c ? '2px solid #1565C0' : '1px solid rgba(0,0,0,0.2)',
            background: STICKY_COLORS[c],
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
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
