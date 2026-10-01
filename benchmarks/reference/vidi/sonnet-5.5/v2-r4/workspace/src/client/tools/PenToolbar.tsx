import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

const THICKNESS_LABELS: Record<PenThickness, string> = { thin: 'Thin', medium: 'Medium', thick: 'Thick' };

export function PenToolbar(props: { color: PenColor; thickness: PenThickness; onColor(c: PenColor): void; onThickness(t: PenThickness): void }) {
  return (
    <div
      role="toolbar"
      aria-label="Pen options"
      data-testid="pen-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 72,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: '#fff',
        borderRadius: 10,
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        zIndex: 20,
        font: '14px system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 28px)', gap: 6 }}>
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${c} pen`}
            title={`${c} pen`}
            aria-pressed={props.color === c}
            onClick={() => props.onColor(c)}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 'none',
              background: PEN_COLORS[c],
              cursor: 'pointer',
              boxShadow: props.color === c ? '0 0 0 2px #fff, 0 0 0 4px #1e88e5' : 'none',
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={props.thickness === t}
            onClick={() => props.onThickness(t)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              border: 'none',
              borderRadius: 6,
              padding: '6px 10px',
              textAlign: 'left',
              cursor: 'pointer',
              background: props.thickness === t ? '#e3f2fd' : 'transparent',
              boxShadow: props.thickness === t ? 'inset 0 0 0 2px #1e88e5' : 'none',
            }}
          >
            <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: PEN_THICKNESS_WORLD[t], background: '#444', borderRadius: 4 }} />
            {THICKNESS_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  );
}
