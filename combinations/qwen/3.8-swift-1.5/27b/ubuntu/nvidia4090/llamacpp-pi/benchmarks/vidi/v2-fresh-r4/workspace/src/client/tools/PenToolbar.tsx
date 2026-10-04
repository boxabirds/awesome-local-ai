/**
 * Pen toolbar (story 11): six colour swatches and three thickness buttons.
 * Visible only while the Pen tool is active.
 */
import type { JSX } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

export function PenToolbar(props: PenToolbarProps): JSX.Element {
  const { color, thickness, onColor, onThickness } = props;

  return (
    <div
      className="pen-toolbar"
      data-vidi6="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pen-toolbar-colors" role="group" aria-label="Pen colour">
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            className={`pen-toolbar-swatch${color === c ? ' pen-toolbar-swatch--active' : ''}`}
            data-vidi6={`pen-color-${c}`}
            aria-label={`${c} pen`}
            aria-pressed={color === c}
            style={{ backgroundColor: PEN_COLORS[c] }}
            onClick={() => onColor(c)}
          />
        ))}
      </div>
      <div className="pen-toolbar-thickness" role="group" aria-label="Pen thickness">
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`pen-toolbar-thickness-btn${thickness === t ? ' pen-toolbar-thickness-btn--active' : ''}`}
            data-vidi6={`pen-thickness-${t}`}
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={thickness === t}
            onClick={() => onThickness(t)}
          >
            <span
              className="pen-toolbar-thickness-dot"
              style={{
                width: `${PEN_THICKNESS_WORLD[t]}px`,
                height: `${PEN_THICKNESS_WORLD[t]}px`,
              }}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
