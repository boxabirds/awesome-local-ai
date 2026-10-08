/**
 * The shape toolbar (story 10, shape.object): fill + outline swatches
 * applied to every selected shape, with the current value highlighted.
 * Rendered by the Board when exactly one shape is selected.
 *
 * Swatch testids: `shape-fill-<name>` / `shape-stroke-<name>`; the row
 * itself is `shape-toolbar`.
 */
import { type JSX } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type ShapeFillColor,
  type ShapeStrokeColor,
} from '../../shared/config';

const SHAPE_FILL_NAMES = Object.keys(SHAPE_FILL_COLORS) as ShapeFillColor[];
const SHAPE_STROKE_NAMES = Object.keys(SHAPE_STROKE_COLORS) as ShapeStrokeColor[];

export interface ShapeToolbarProps {
  fill: ShapeFillColor | undefined;
  stroke: ShapeStrokeColor | undefined;
  onFill(name: ShapeFillColor): void;
  onStroke(name: ShapeStrokeColor): void;
}

export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps): JSX.Element {
  return (
    <div
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape"
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 10px',
        background: '#fff',
        border: '1px solid #d9d9d4',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}
    >
      {SHAPE_FILL_NAMES.map((name) => (
        <button
          key={`fill-${name}`}
          type="button"
          data-testid={`shape-fill-${name}`}
          aria-label={`${name} fill`}
          aria-pressed={fill === name}
          onClick={() => onFill(name)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            border: fill === name ? '2px solid #1a73e8' : '1px solid #b5b5ae',
            background: name === 'none' ? 'repeating-linear-gradient(45deg, #fff 0 4px, #e4e4e0 4px 8px)' : SHAPE_FILL_COLORS[name],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <div style={{ width: 8 }} aria-hidden="true" />
      {SHAPE_STROKE_NAMES.map((name) => (
        <button
          key={`stroke-${name}`}
          type="button"
          data-testid={`shape-stroke-${name}`}
          aria-label={`${name} outline`}
          aria-pressed={stroke === name}
          onClick={() => onStroke(name)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            border: stroke === name ? '2px solid #1a73e8' : '1px solid #b5b5ae',
            background: SHAPE_STROKE_COLORS[name],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}
