import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  /** True while the board cannot be edited (load failure): every button here is
   * disabled, matching the read-only board underneath. */
  disabled?: boolean;
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow colour',
  orange: 'Orange colour',
  green: 'Green colour',
  blue: 'Blue colour',
  pink: 'Pink colour',
  violet: 'Violet colour',
};

/**
 * The floating toolbar for the selected note: six colour swatches (each named
 * in its accessible label, so colour is not the only signal) and a delete (bin)
 * button. Rendered in screen space above the note. Stops pointer propagation so
 * a click never reaches the viewport (which would clear the selection).
 */
export function NoteToolbar({ color, onColor, onDelete, disabled = false }: NoteToolbarProps) {
  return (
    <div
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note options"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        padding: 4,
        background: '#ffffff',
        border: '1px solid rgba(17,17,17,0.12)',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => (
        <button
          key={name}
          type="button"
          aria-label={LABELS[name]}
          aria-pressed={color === name}
          disabled={disabled}
          title={LABELS[name]}
          onClick={() => onColor(name)}
          style={{
            width: 22,
            height: 22,
            padding: 0,
            borderRadius: 4,
            cursor: 'pointer',
            background: STICKY_COLORS[name],
            border: color === name ? '2px solid #111' : '1px solid rgba(0,0,0,0.25)',
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        data-testid="note-delete"
        disabled={disabled}
        onClick={() => onDelete()}
        style={{
          width: 26,
          height: 22,
          marginLeft: 2,
          padding: 0,
          borderRadius: 4,
          cursor: 'pointer',
          border: '1px solid rgba(0,0,0,0.25)',
          background: '#fff',
          lineHeight: '20px',
        }}
      >
        🗑
      </button>
    </div>
  );
}