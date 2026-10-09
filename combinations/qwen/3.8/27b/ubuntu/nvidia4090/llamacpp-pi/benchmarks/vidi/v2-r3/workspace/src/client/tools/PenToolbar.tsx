import type { ReactElement } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

/**
 * Story 11 (pen.options): the pen's options toolbar — six colour swatches and
 * three thickness buttons, shown next to the left toolbar while the Pen tool
 * is active. The active choice is aria-pressed.
 */

const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

function colorLabel(c: PenColor): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export function PenToolbar(props: {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}): ReactElement {
  return (
    <div
      data-pen-toolbar="true"
      aria-label="Pen options"
      style={{
        position: 'fixed',
        left: 76, // just right of the left toolbar (12 + 56 toolbar + 8 gap)
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: '#fff',
        border: '1px solid #d5d9e0',
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        zIndex: 20,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${colorLabel(c)} pen`}
            title={`${colorLabel(c)} pen`}
            aria-pressed={props.color === c}
            onClick={() => props.onColor(c)}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: PEN_COLORS[c],
              border:
                props.color === c ? '2px solid #1a73e8' : '2px solid rgba(0,0,0,0.15)',
              boxSizing: 'border-box',
              cursor: 'pointer',
            }}
          />
        ))}
      </div>
      <div style={{ height: 1, background: '#e4e7ec', margin: '2px 0' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-label={THICKNESS_LABELS[t]}
            title={`${THICKNESS_LABELS[t]} pen`}
            aria-pressed={props.thickness === t}
            onClick={() => props.onThickness(t)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid #d5d9e0',
              background: props.thickness === t ? '#e8f0fe' : '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <span
              style={{
                display: 'block',
                width: 16,
                height: Math.max(2, PEN_THICKNESS_WORLD[t]),
                borderRadius: 2,
                background: '#23272e',
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
