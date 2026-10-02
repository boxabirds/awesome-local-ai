import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const SWATCH_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

function colourLabel(c: StickyColor): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/**
 * Floating toolbar for the selected note: six colour swatches (one per
 * STICKY_COLORS preset, distinguishable by name via tooltip and accessible
 * label) and a delete (bin) button. Rendered in screen space (counter-scaled
 * by the parent) above the note.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  return (
    <div
      data-testid="note-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: 'rgba(255,255,255,0.95)',
        borderRadius: 8,
        padding: '4px 6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        whiteSpace: 'nowrap',
      }}
    >
      {SWATCH_ORDER.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${colourLabel(c)} colour`}
          title={`${colourLabel(c)} colour`}
          aria-pressed={color === c}
          data-testid={`swatch-${c}`}
          onClick={() => onColor(c)}
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            padding: 0,
            cursor: 'pointer',
            background: STICKY_COLORS[c],
            border: color === c ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.25)',
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        data-testid="note-delete"
        onClick={onDelete}
        style={{
          width: 26,
          height: 26,
          marginLeft: 2,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 15,
          lineHeight: 1,
          padding: 0,
        }}
      >
        <span aria-hidden>🗑</span>
      </button>
    </div>
  );
}
