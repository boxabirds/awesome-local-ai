import { STICKY_COLORS, type StickyColor } from '../../shared/config';

interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

/**
 * Floating toolbar for the selected note: six colour swatches + delete (bin).
 * Rendered in screen space above the note (see the counter-scaled wrapper in
 * StickyNote); hidden while Dragging or Editing. Swatches are distinguishable
 * by name (tooltip + accessible label), not only by colour.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  return (
    <div
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note options"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 6px',
        background: '#fff',
        borderRadius: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        whiteSpace: 'nowrap',
      }}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${COLOR_NAMES[c]} colour`}
          aria-pressed={c === color}
          title={COLOR_NAMES[c]}
          onClick={() => onColor(c)}
          style={{
            width: 18,
            height: 18,
            padding: 0,
            background: STICKY_COLORS[c],
            border: c === color ? '2px solid #2563eb' : '1px solid rgba(0,0,0,0.25)',
            borderRadius: 4,
            cursor: 'pointer',
            boxSizing: 'border-box',
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: '#d3302f',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M6 2a1 1 0 0 0-1 1v1H2v2h12V4h-3V3a1 1 0 0 0-1-1H6zM4 6v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6H4z" />
        </svg>
      </button>
    </div>
  );
}
