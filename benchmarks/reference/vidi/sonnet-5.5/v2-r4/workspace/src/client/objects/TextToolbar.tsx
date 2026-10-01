import { TEXT_SIZES, type TextSize } from '../../shared/config';

const SIZE_KEYS = Object.keys(TEXT_SIZES) as TextSize[];

export function TextToolbar(props: { size: TextSize; onSize(s: TextSize): void; onDelete(): void }) {
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <div
      role="toolbar"
      aria-label="Text tools"
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
        font: '14px system-ui, sans-serif',
      }}
    >
      {SIZE_KEYS.map((s) => (
        <button
          key={s}
          type="button"
          title={`Size ${s}`}
          aria-pressed={props.size === s}
          onClick={() => props.onSize(s)}
          style={{
            minWidth: 30,
            height: 26,
            borderRadius: 6,
            border: props.size === s ? '2px solid #1e88e5' : '1px solid rgba(0,0,0,0.3)',
            background: props.size === s ? '#e3f2fd' : '#fff',
            cursor: 'pointer',
            font: 'inherit',
            padding: '0 6px',
          }}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        aria-label="Delete text"
        title="Delete text"
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
