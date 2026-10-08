// PenToolbar (story 11, pen.options): the pen's six colour swatches and the
// thin / medium / thick buttons. Shown next to the left toolbar only while
// the Pen tool is active. The choice is session state (usePenOptions);
// changing it never touches existing strokes.

import type { JSX } from 'react';
import { PEN_COLORS } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

/** The three thickness buttons, thinnest first. */
const THICKNESS_ORDER: readonly PenThickness[] = ['thin', 'medium', 'thick'];

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

export function PenToolbar(props: PenToolbarProps): JSX.Element {
  const { color, thickness, onColor, onThickness } = props;
  return (
    <div
      className="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="pen-toolbar__group" aria-label="Pen colours">
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            className="pen-toolbar__swatch"
            aria-label={`${c} pen`}
            aria-pressed={color === c}
            data-testid={`pen-color-${c}`}
            style={{ background: PEN_COLORS[c] }}
            onClick={() => onColor(c)}
          />
        ))}
      </div>
      <div className="pen-toolbar__group" aria-label="Pen thickness">
        {THICKNESS_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            className="pen-toolbar__thickness"
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={thickness === t}
            data-testid={`pen-thickness-${t}`}
            onClick={() => onThickness(t)}
          >
            {/* The dot previews the line width (screen px ≈ world units at 100%). */}
            <span
              aria-hidden="true"
              style={{
                display: 'block',
                width: 2 + PEN_THICKNESS_PREVIEW[t],
                height: 2 + PEN_THICKNESS_PREVIEW[t],
                borderRadius: '50%',
                background: '#212121',
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Relative dot size for the thickness buttons (screen px at 100%). */
const PEN_THICKNESS_PREVIEW: Record<PenThickness, number> = { thin: 0, medium: 2, thick: 4 };
