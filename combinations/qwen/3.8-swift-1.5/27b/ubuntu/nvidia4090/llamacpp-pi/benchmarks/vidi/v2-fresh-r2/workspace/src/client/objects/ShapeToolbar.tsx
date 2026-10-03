/**
 * Floating toolbar for the selected shape (story 10, shape.toolbar):
 * 6 fill swatches, 4 stroke swatches, delete. Rendered in screen space
 * above the shape (not scaled by zoom), like the note toolbar.
 */

import type { JSX } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type ShapeFillColor,
  type ShapeStrokeColor,
} from '../../shared/config';

interface ShapeToolbarProps {
  fill: ShapeFillColor;
  stroke: ShapeStrokeColor;
  onFill(c: ShapeFillColor): void;
  onStroke(c: ShapeStrokeColor): void;
  onDelete(): void;
}

const FILL_NAMES = Object.keys(SHAPE_FILL_COLORS) as ShapeFillColor[];
const STROKE_NAMES = Object.keys(SHAPE_STROKE_COLORS) as ShapeStrokeColor[];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ShapeToolbar({ fill, stroke, onFill, onStroke, onDelete }: ShapeToolbarProps): JSX.Element {
  return (
    <div
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape tools"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: -52,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        backgroundColor: 'white',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        zIndex: 1000,
        whiteSpace: 'nowrap',
      }}
    >
      {FILL_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          data-testid={`shape-fill-${name}`}
          aria-label={`Fill ${cap(name)}`}
          aria-pressed={fill === name}
          onClick={() => onFill(name)}
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: fill === name ? '2px solid #333' : '1px solid #ccc',
            backgroundColor: SHAPE_FILL_COLORS[name],
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <div style={{ width: 1, height: 20, background: '#ddd', margin: '0 2px' }} />
      {STROKE_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          data-testid={`shape-stroke-${name}`}
          aria-label={`Stroke ${cap(name)}`}
          aria-pressed={stroke === name}
          onClick={() => onStroke(name)}
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: `3px solid ${SHAPE_STROKE_COLORS[name]}`,
            backgroundColor: 'white',
            outline: stroke === name ? '2px solid #333' : 'none',
            outlineOffset: 1,
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
      <button
        type="button"
        data-testid="delete-shape-btn"
        aria-label="Delete shape"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          border: 'none',
          backgroundColor: 'transparent',
          cursor: 'pointer',
          fontSize: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: 4,
        }}
      >
        🗑
      </button>
    </div>
  );
}
