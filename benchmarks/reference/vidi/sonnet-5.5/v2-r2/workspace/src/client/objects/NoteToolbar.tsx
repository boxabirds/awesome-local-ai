import { STICKY_COLORS, type StickyColor } from '../../shared/config';

interface Props {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const label = (c: string) => `${c[0].toUpperCase()}${c.slice(1)} colour`;

export function NoteToolbar({ color, onColor, onDelete }: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Note toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        background: '#fff',
        border: '1px solid #d5d9e0',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        cursor: 'default',
      }}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          aria-label={label(c)}
          title={label(c)}
          aria-pressed={c === color}
          onClick={() => onColor(c)}
          style={{
            width: 22,
            height: 22,
            padding: 0,
            borderRadius: '50%',
            background: STICKY_COLORS[c],
            border: c === color ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.25)',
            cursor: 'pointer',
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
        style={{ width: 26, height: 26, padding: 0, marginLeft: 2, cursor: 'pointer', background: 'none', border: 'none' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
        </svg>
      </button>
    </div>
  );
}
