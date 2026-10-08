import * as React from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from '../../shared/config';

// Hex values stored in shapes; keys are colour names for display
type FillColor = keyof typeof SHAPE_FILL_COLORS;
type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

interface ShapeToolbarProps {
  fill: string; // hex value stored in shape
  stroke: string; // hex value stored in shape
  onFill(hex: string): void;
  onStroke(hex: string): void;
}

/** Map of hex → key name for UI labels */
function reverseMap(palette: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, val] of Object.entries(palette)) {
    map.set(val, key);
  }
  return map;
}

const FILL_KEY_MAP = reverseMap(SHAPE_FILL_COLORS);
const STROKE_KEY_MAP = reverseMap(SHAPE_STROKE_COLORS);

export function ShapeToolbar(props: ShapeToolbarProps): React.JSX.Element {
  const { fill, stroke, onFill, onStroke } = props;

  return (
    <div
      className="shape-toolbar"
      style={{
        display: 'flex',
        gap: '8px',
        padding: '6px 8px',
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        zIndex: 100,
        flexWrap: 'wrap',
        maxWidth: 320,
      }}
      role="toolbar"
      aria-label="Shape styling toolbar"
    >
      {/* Fill swatches */}
      {Object.entries(SHAPE_FILL_COLORS).map(([name, hex]) => (
        <button
          key={`fill-${name}`}
          onClick={() => onFill(hex)}
          aria-label={`${name} fill`}
          title={name === 'none' ? 'No fill' : name}
          style={{
            width: '24px',
            height: '24px',
            border: fill === hex ? '2px solid #1a73e8' : '1px solid #ccc',
            borderRadius: '50%',
            background: hex,
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}

      {/* Outline swatches */}
      {Object.entries(SHAPE_STROKE_COLORS).map(([name, hex]) => (
        <button
          key={`stroke-${name}`}
          onClick={() => onStroke(hex)}
          aria-label={`${name} outline`}
          title={name}
          style={{
            width: '24px',
            height: '24px',
            border: stroke === hex ? '2px solid #1a73e8' : '1px solid #ccc',
            borderRadius: '50%',
            background: hex,
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}
