/**
 * Story 10: the shape colour toolbar (shape.style).
 *
 * Shown by the board above the EXACTLY-one-selected shape (like the sticky
 * note toolbar). Fill row: six colours + no fill; outline row: six colours.
 * Each swatch is `button[aria-label="<colour> fill"]` / `"<colour> outline"`
 * (PRD + design) and calls `onFill`/`onStroke` with the palette key — the
 * board applies it with `setShapeStyle` inside an undo boundary, keeping the
 * label, size, position and selection unchanged.
 */
import type { JSX } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from 'src/shared/config';
import type { FillColor, StrokeColor } from 'src/shared/objects/shape';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}

const SWATCH_PX = 20;

function swatchStyle(color: string, active: boolean, isNone: boolean): React.CSSProperties {
  return {
    width: SWATCH_PX,
    height: SWATCH_PX,
    padding: 0,
    flex: '0 0 auto',
    cursor: 'pointer',
    border: `2px solid ${active ? '#1A73E8' : isNone ? '#b0b0b0' : 'rgba(0,0,0,0.25)'}`,
    borderRadius: 4,
    boxSizing: 'border-box',
    backgroundColor: isNone ? '#FFFFFF' : color,
    // "No fill" reads as an empty swatch: a red diagonal over white.
    backgroundImage: isNone ? 'linear-gradient(135deg, transparent 44%, #E53935 44%, #E53935 56%, transparent 56%)' : undefined,
    outline: active ? `2px solid ${'#1A73E8'}` : 'none',
    outlineOffset: 1,
  };
}

export function ShapeToolbar(props: ShapeToolbarProps): JSX.Element {
  const fills = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
  const strokes = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];
  return (
    <div
      data-testid="shape-toolbar"
      aria-label="Shape colours"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 6,
        backgroundColor: '#ffffff',
        border: '1px solid #d0d7de',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {fills.map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`shape-swatch-fill-${c}`}
            aria-label={`${c} fill`}
            aria-pressed={props.fill === c}
            onClick={() => props.onFill(c)}
            style={swatchStyle(SHAPE_FILL_COLORS[c], props.fill === c, c === 'none')}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {strokes.map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`shape-swatch-stroke-${c}`}
            aria-label={`${c} outline`}
            aria-pressed={props.stroke === c}
            onClick={() => props.onStroke(c)}
            style={swatchStyle(SHAPE_STROKE_COLORS[c], props.stroke === c, false)}
          />
        ))}
      </div>
    </div>
  );
}
