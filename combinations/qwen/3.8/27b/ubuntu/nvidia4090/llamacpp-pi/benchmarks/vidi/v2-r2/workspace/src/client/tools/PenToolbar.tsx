/**
 * Pen toolbar (story 11, pen.options): six colour swatches and three
 * thickness buttons, shown only while the Pen tool is active, next to the
 * left toolbar.
 *
 * Each control reports through the session-only pen options (usePenOptions);
 * changing them never touches existing strokes. Buttons are
 * `button[aria-label="<colour> pen"][aria-pressed]` and
 * `button[aria-label="Thin|Medium|Thick"]` (design pen.options), and the
 * thickness buttons are dots scaled to their actual thickness.
 */
import { type CSSProperties, type JSX } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

const SWATCH_PX = 22;

const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

/** The thickness dot: a circle whose diameter is the (world) thickness. */
const THICKNESS_DOT_PX: Record<PenThickness, number> = {
  thin: 4,
  medium: 7,
  thick: 12,
};

const CONTROL_BUTTON: CSSProperties = {
  width: 28,
  height: 28,
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  border: '1px solid rgba(0,0,0,0.18)',
  borderRadius: 6,
  cursor: 'pointer',
};

export function PenToolbar({
  color,
  thickness,
  onColor,
  onThickness,
}: PenToolbarProps): JSX.Element {
  return (
    <div
      data-testid="pen-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 80,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: 'rgba(255,255,255,0.94)',
        border: '1px solid #d8d8d0',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        zIndex: 2000,
      }}
    >
      <div
        data-testid="pen-colors"
        role="radiogroup"
        aria-label="Pen colour"
        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        {(Object.keys(PEN_COLORS) as PenColor[]).map((name) => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={color === name}
            aria-label={`${name} pen`}
            title={`${name} pen`}
            data-testid={`pen-color-${name}`}
            onClick={() => onColor(name)}
            style={{
              ...CONTROL_BUTTON,
              background: color === name ? '#e8f0fe' : '#ffffff',
              outline: color === name ? '1px solid #1a73e8' : 'none',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: SWATCH_PX - 4,
                height: SWATCH_PX - 4,
                display: 'block',
                borderRadius: '50%',
                background: PEN_COLORS[name],
              }}
            />
          </button>
        ))}
      </div>
      <div
        data-testid="pen-thicknesses"
        role="radiogroup"
        aria-label="Pen thickness"
        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((name) => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={thickness === name}
            aria-label={THICKNESS_LABELS[name]}
            title={`${THICKNESS_LABELS[name]} pen`}
            data-testid={`pen-thickness-${name}`}
            onClick={() => onThickness(name)}
            style={{
              ...CONTROL_BUTTON,
              background: thickness === name ? '#e8f0fe' : '#ffffff',
              outline: thickness === name ? '1px solid #1a73e8' : 'none',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: THICKNESS_DOT_PX[name],
                height: THICKNESS_DOT_PX[name],
                display: 'block',
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
