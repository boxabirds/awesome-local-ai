/**
 * Story 11: pen options panel (pen.options, pen.aria).
 *
 * A vertical floating panel to the LEFT of the main toolbar (the main
 * toolbar is 56 px wide at the left edge), visible only while the tool is
 * `pen`: six colour circles (`aria-label="<colour> pen"`, `aria-pressed`)
 * and three thickness buttons (`aria-label="Thin"/"Medium"/"Thick"`,
 * `aria-pressed`). Selecting an option takes effect on the NEXT stroke
 * (PenTool reads the values at commit time); the live preview uses them
 * immediately. Presses are stopped so they never start a stroke or pan.
 */
import type { JSX } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from 'src/shared/config';
import type { PenColor, PenThickness } from 'src/shared/objects/stroke';

const THICKNESS_ORDER: PenThickness[] = ['thin', 'medium', 'thick'];
const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

export function PenToolbar(props: {
  color: PenColor;
  thickness: PenThickness;
  onColor: (c: PenColor) => void;
  onThickness: (t: PenThickness) => void;
}): JSX.Element {
  return (
    <div
      data-testid="pen-toolbar"
      role="group"
      aria-label="Pen options"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 80,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: 10,
        backgroundColor: '#fff',
        border: '1px solid #d0d7de',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        zIndex: 1000,
      }}
    >
      <div data-testid="pen-colors" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${c} pen`}
            aria-pressed={props.color === c}
            data-testid={`pen-color-${c}`}
            onClick={() => props.onColor(c)}
            style={{
              width: 22,
              height: 22,
              padding: 0,
              borderRadius: '50%',
              backgroundColor: PEN_COLORS[c],
              border: props.color === c ? '2px solid #1A73E8' : '1px solid rgba(0, 0, 0, 0.25)',
              cursor: 'pointer',
            }}
          />
        ))}
      </div>
      <div data-testid="pen-thicknesses" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {THICKNESS_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={props.thickness === t}
            data-testid={`pen-thickness-${t}`}
            onClick={() => props.onThickness(t)}
            style={{
              width: 26,
              height: 26,
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              backgroundColor: '#fff',
              border:
                props.thickness === t ? '2px solid #1A73E8' : '1px solid rgba(0, 0, 0, 0.25)',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                width: PEN_THICKNESS_WORLD[t],
                height: PEN_THICKNESS_WORLD[t],
                borderRadius: '50%',
                backgroundColor: '#212121',
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
