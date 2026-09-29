import type { ReactElement } from 'react';
import type { PenColor, PenThickness } from '@/shared/objects/stroke';
import { PEN_SWATCHES, PEN_THICKNESSES } from './usePenOptions';

/**
 * Pen options toolbar (story 11, pen.options): six ink swatches and three
 * line-thickness presets, in a fixed bar right of the main toolbar. It is
 * pure session UI — it calls the setters of usePenOptions and never touches
 * the doc. Pointer events are captured locally (the bar is a sibling of the
 * viewport, so it can never start a pan/drag).
 *
 * - Swatch buttons: aria-label "<colour> pen", data-testid "pen-color-<name>",
 *   aria-pressed when selected; the selected swatch gets a ring.
 * - Thickness buttons: aria-label "<name> line", data-testid
 *   "pen-thickness-<name>", aria-pressed when selected; the line preview is
 *   drawn at a constant SCREEN size (the real width scales with zoom, but a
 *   toolbar swatch must not — it is a setting preview, not board content).
 */
export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

/** Screen-space preview width (px) for each thickness swatch. */
const PREVIEW_WIDTH_PX: Record<PenThickness, number> = { thin: 3, medium: 5, thick: 9 };

const SWATCH = 22;

export function PenToolbar(props: PenToolbarProps): ReactElement {
  return (
    <div
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 84,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 10,
        background: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        zIndex: 10,
      }}
    >
      {/* Ink swatches. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {PEN_SWATCHES.map(({ name, color }) => {
          const selected = name === props.color;
          return (
            <button
              key={name}
              type="button"
              aria-label={`${name} pen`}
              aria-pressed={selected}
              data-testid={`pen-color-${name}`}
              title={`${name} ink`}
              onClick={() => props.onColor(name)}
              style={{
                width: SWATCH,
                height: SWATCH,
                padding: 0,
                borderRadius: '50%',
                background: color,
                border: selected ? '2px solid #1A73E8' : '1px solid rgba(0, 0, 0, 0.25)',
                outline: selected ? '2px solid rgba(26, 115, 232, 0.4)' : 'none',
                outlineOffset: 1,
                cursor: 'pointer',
              }}
            />
          );
        })}
      </div>
      {/* Line thickness presets. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {PEN_THICKNESSES.map(({ name, width }) => {
          const selected = name === props.thickness;
          return (
            <button
              key={name}
              type="button"
              aria-label={`${name} line`}
              aria-pressed={selected}
              data-testid={`pen-thickness-${name}`}
              title={`${name} line (${width} px at 100%)`}
              onClick={() => props.onThickness(name)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
                height: 26,
                padding: 0,
                borderRadius: 6,
                border: selected ? '1px solid #1A73E8' : '1px solid rgba(0, 0, 0, 0.15)',
                background: selected ? 'rgba(26, 115, 232, 0.15)' : 'rgba(255, 255, 255, 0.9)',
                cursor: 'pointer',
              }}
            >
              {/* Constant screen-size preview of the line. */}
              <div
                aria-hidden="true"
                style={{
                  width: 28,
                  height: PREVIEW_WIDTH_PX[name],
                  borderRadius: PREVIEW_WIDTH_PX[name] / 2,
                  background: '#333333',
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
