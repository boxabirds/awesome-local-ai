// The shape's own toolbar: what a selected shape is filled with and outlined in
// (`shape.style`).
//
// Six fill swatches plus "no fill", six outline swatches, and the bin. The two groups
// are deliberately not one palette: a shape's fill and its outline are separate writes
// (`setShapeStyle` changes one key), and a bar that offered "blue" once would have to
// guess which of the two you meant.
//
// The accessible names say which of the two they are: `Blue fill`, `Blue outline`. A
// swatch that is on looks pressed, and the one that is on is the shape's current colour,
// so the bar says what the shape already is as well as what it could be.
//
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
import { type CSSProperties, type ReactNode } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type ShapeFill,
  type ShapeStroke,
} from '../../shared/config';
import { shapeFillCss, shapeStrokeCss } from '../../shared/objects/shape';

export interface ShapeToolbarProps {
  fill: ShapeFill;
  stroke: ShapeStroke;
  onFill(fill: ShapeFill): void;
  onStroke(stroke: ShapeStroke): void;
  onDelete(): void;
}

/** The colour name as it appears in a swatch's accessible name and tooltip. */
export const shapeColorLabel = (name: string): string =>
  name.charAt(0).toUpperCase() + name.slice(1);

const FILLS = Object.keys(SHAPE_FILL_COLORS) as ShapeFill[];
const STROKES = Object.keys(SHAPE_STROKE_COLORS) as ShapeStroke[];

/** The name a "no fill" swatch is called by, in the bar and in the tests. */
export const NO_FILL_LABEL = 'No fill';

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 4,
  borderRadius: 8,
  backgroundColor: 'rgba(255, 255, 255, 0.96)',
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.22)',
};

const swatchStyle = (color: string, active: boolean): CSSProperties => ({
  width: 18,
  height: 18,
  padding: 0,
  borderRadius: 4,
  border: active ? '2px solid #1f2328' : '1px solid rgba(0, 0, 0, 0.25)',
  backgroundColor: color,
  cursor: 'pointer',
});

const dividerStyle: CSSProperties = {
  width: 1,
  height: 18,
  margin: '0 2px',
  backgroundColor: 'rgba(0, 0, 0, 0.15)',
};

/**
 * The bar above the board when exactly one shape is selected. It stops pointer events
 * so a click on a swatch is never also a click on the board (which would clear the
 * selection, and so take the bar away before the second swatch could be clicked).
 */
export function ShapeToolbar({ fill, stroke, onFill, onStroke, onDelete }: ShapeToolbarProps): ReactNode {
  return (
    <div
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape toolbar"
      style={barStyle}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {FILLS.map((name) => {
        const label = name === 'none' ? NO_FILL_LABEL : `${shapeColorLabel(name)} fill`;
        return (
          <button
            key={name}
            type="button"
            data-testid={`swatch-fill-${name}`}
            aria-label={label}
            aria-pressed={name === fill}
            title={label}
            style={swatchStyle(shapeFillCss(name), name === fill)}
            onClick={() => onFill(name)}
          />
        );
      })}
      <span style={dividerStyle} aria-hidden="true" />
      {STROKES.map((name) => {
        const label = `${shapeColorLabel(name)} outline`;
        return (
          <button
            key={name}
            type="button"
            data-testid={`swatch-stroke-${name}`}
            aria-label={label}
            aria-pressed={name === stroke}
            title={label}
            style={swatchStyle(shapeStrokeCss(name), name === stroke)}
            onClick={() => onStroke(name)}
          />
        );
      })}
      <button
        type="button"
        data-testid="delete-shape"
        aria-label="Delete shape"
        title="Delete shape"
        className="vidi6-icon-button"
        style={{ marginLeft: 2 }}
        onClick={onDelete}
      >
        {'\u{1F5D1}'}
      </button>
    </div>
  );
}
