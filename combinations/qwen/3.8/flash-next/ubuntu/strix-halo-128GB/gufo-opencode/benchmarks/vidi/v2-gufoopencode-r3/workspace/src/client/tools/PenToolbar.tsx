import type { JSX } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness
} from '../../shared/config';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick'
};

// Pen options bar shown beside the left toolbar while the Pen tool is
// active: six colour swatches and Thin / Medium / Thick. Choices apply to
// the next stroke only; finished strokes are never restyled.
export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps): JSX.Element {
  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen toolbar"
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="pen-toolbar-swatch"
          data-testid={`pen-color-${c}`}
          aria-label={`${c} pen`}
          title={`${c} pen`}
          aria-pressed={c === color}
          style={{ background: PEN_COLORS[c] }}
          onClick={() => {
            onColor(c);
          }}
        />
      ))}
      <div className="pen-toolbar-separator" aria-hidden="true" />
      {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
        <button
          key={t}
          type="button"
          className="pen-toolbar-thickness"
          data-testid={`pen-thickness-${t}`}
          aria-label={THICKNESS_LABELS[t]}
          title={`${THICKNESS_LABELS[t]} (${PEN_THICKNESS_WORLD[t]} px at 100%)`}
          aria-pressed={t === thickness}
          onClick={() => {
            onThickness(t);
          }}
        >
          {THICKNESS_LABELS[t]}
        </button>
      ))}
    </div>
  );
}
