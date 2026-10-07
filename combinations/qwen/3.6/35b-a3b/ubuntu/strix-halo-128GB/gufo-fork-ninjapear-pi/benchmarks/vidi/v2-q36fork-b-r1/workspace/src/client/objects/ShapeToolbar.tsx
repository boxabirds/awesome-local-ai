import { type ReactNode } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from '@/shared/config';
import type { FillColor, StrokeColor } from '@/shared/objects/shape';

interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}

/** Toolbar for shape styling — fill swatches (6 colours + no fill) and outline swatches (6 colours). */
export function ShapeToolbar(props: ShapeToolbarProps): ReactNode {
  const { fill, stroke, onFill, onStroke } = props;

  return (
    <div
      data-testid="shape-toolbar"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        top: '16px',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        backgroundColor: '#fff',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        border: '1px solid #ddd',
      }}
    >
      {/* Fill swatches */}
      <span style={{ fontSize: '11px', color: '#666', marginRight: '4px' }}>Fill:</span>
      {Object.entries(SHAPE_FILL_COLORS).map(([name, hex]) => (
        <button
          key={`fill-${name}`}
          aria-label={`${name} fill`}
          data-testid={`fill-swatch-${name}`}
          title={name === 'none' ? 'No fill' : name}
          onClick={() => onFill(name as FillColor)}
          style={{
            width: '24px',
            height: '24px',
            border: fill === name ? '2px solid #2979ff' : '1px solid #ccc',
            borderRadius: '4px',
            cursor: 'pointer',
            backgroundColor: hex,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
          }}
        >
          {name === 'none' && '×'}
        </button>
      ))}

      <div style={{ width: '1px', height: '20px', backgroundColor: '#ddd' }} />

      {/* Outline swatches */}
      <span style={{ fontSize: '11px', color: '#666', marginRight: '4px' }}>Outline:</span>
      {Object.entries(SHAPE_STROKE_COLORS).map(([name, hex]) => (
        <button
          key={`stroke-${name}`}
          aria-label={`${name} outline`}
          data-testid={`outline-swatch-${name}`}
          title={name}
          onClick={() => onStroke(name as StrokeColor)}
          style={{
            width: '24px',
            height: '24px',
            border: stroke === name ? '2px solid #2979ff' : `1px solid ${hex}`,
            borderRadius: '4px',
            cursor: 'pointer',
            backgroundColor: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              backgroundColor: hex,
              border: stroke === name ? '1px solid #2979ff' : 'none',
            }}
          />
        </button>
      ))}
    </div>
  );
}
