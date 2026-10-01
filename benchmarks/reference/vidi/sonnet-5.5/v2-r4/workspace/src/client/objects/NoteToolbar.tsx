import { STICKY_COLORS, type StickyColor } from '../../shared/config';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];
const label = (c: StickyColor) => `${c[0].toUpperCase()}${c.slice(1)}`;

export function NoteToolbar(props: { color: StickyColor; onColor(c: StickyColor): void; onDelete(): void }) {
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <div
      role="toolbar"
      aria-label="Note tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
      onClick={stop}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: 6,
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        cursor: 'default',
        whiteSpace: 'nowrap',
      }}
    >
      {COLOR_NAMES.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${label(c)} colour`}
          title={`${label(c)} colour`}
          aria-pressed={props.color === c}
          onClick={() => props.onColor(c)}
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: STICKY_COLORS[c],
            border: props.color === c ? '2px solid #1e88e5' : '1px solid rgba(0,0,0,0.3)',
            padding: 0,
            cursor: 'pointer',
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        onClick={props.onDelete}
        style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', padding: 2 }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
        </svg>
      </button>
    </div>
  );
}
