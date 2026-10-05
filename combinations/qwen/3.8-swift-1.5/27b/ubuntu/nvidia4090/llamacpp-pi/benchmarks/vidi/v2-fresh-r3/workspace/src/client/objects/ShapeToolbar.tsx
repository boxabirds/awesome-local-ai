import type { JSX } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from '../../shared/config';

export interface ShapeToolbarProps {
  fill: string;
  stroke: string;
  onFill(c: string): void;
  onStroke(c: string): void;
}

const swatchSize = 20;

/**
 * Toolbar shown when a single shape is selected. Provides fill swatches
 * (7: none + 6 colours) and outline swatches (6 colours).
 */
export function ShapeToolbar(props: ShapeToolbarProps): JSX.Element {
  const { fill, stroke, onFill, onStroke } = props;

  const fillEntries = Object.entries(SHAPE_FILL_COLORS) as [string, string][];
  const strokeEntries = Object.entries(SHAPE_STROKE_COLORS) as [string, string][];

  return (
    <div
      data-testid="shape-toolbar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 6,
        background: 'rgba(255,255,255,0.95)',
        border: '1px solid #ccc',
        borderRadius: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      }}
    >
      <div style={{ display: 'flex', gap: 3 }}>
        {fillEntries.map(([name, color]) => (
          <button
            key={name}
            type="button"
            data-testid={`fill-${name}`}
            aria-label={`${name} fill`}
            title={`${name} fill`}
            onClick={() => onFill(name)}
            style={{
              width: swatchSize,
              height: swatchSize,
              border: fill === name ? '2px solid #1A73E8' : '1px solid #999',
              borderRadius: 3,
              background: color === 'transparent' ? 'repeating-linear-gradient(45deg, #eee, #eee 3px, #fff 3px, #fff 6px)' : color,
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {strokeEntries.map(([name, color]) => (
          <button
            key={name}
            type="button"
            data-testid={`stroke-${name}`}
            aria-label={`${name} outline`}
            title={`${name} outline`}
            onClick={() => onStroke(name)}
            style={{
              width: swatchSize,
              height: swatchSize,
              border: stroke === name ? '2px solid #1A73E8' : '1px solid #999',
              borderRadius: 3,
              background: color,
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}
