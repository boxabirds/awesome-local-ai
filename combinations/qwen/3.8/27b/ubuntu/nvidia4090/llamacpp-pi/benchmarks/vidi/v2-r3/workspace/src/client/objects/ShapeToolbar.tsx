import type { ReactElement } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, SHAPE_LABEL_MAX_CHARS } from '../../shared/config';
import type { FillColor, ShapeKind, StrokeColor } from '../../shared/objects/shape';

/** The palette's display name ("No fill" for the transparent entry). */
function colorName(key: string, noneName: string): string {
  if (key === 'none') return noneName;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Story 10 (shapes): the floating style toolbar of the selected shape — the
 * fill swatches (7, first "No fill") and the outline swatches (6), each an
 * aria-labelled button. Rendered above the shape (inside its element) like
 * the sticky note's NoteToolbar. Clicking a swatch calls back with the
 * palette name; the shape's selection and label are untouched.
 */
export function ShapeToolbar(props: {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}): ReactElement {
  return (
    <div
      className="shape-toolbar"
      style={{
        position: 'absolute',
        top: -46,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: '#fff',
        border: '1px solid #d5d9e0',
        borderRadius: 8,
        padding: '4px 6px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        zIndex: 10,
        whiteSpace: 'nowrap',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((c) => (
        <Swatch
          key={c}
          ariaLabel={colorName(c, 'No fill') + ' fill'}
          pressed={props.fill === c}
          background={SHAPE_FILL_COLORS[c]}
          onClick={() => props.onFill(c)}
        />
      ))}
      <div style={{ width: 1, height: 16, background: '#e4e7ec', margin: '0 2px' }} />
      {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((c) => (
        <Swatch
          key={c}
          ariaLabel={colorName(c, 'No outline') + ' outline'}
          pressed={props.stroke === c}
          background={SHAPE_STROKE_COLORS[c]}
          onClick={() => props.onStroke(c)}
        />
      ))}
    </div>
  );
}

function Swatch(props: {
  ariaLabel: string;
  pressed: boolean;
  background: string;
  onClick(): void;
}): ReactElement {
  const none = props.background === 'transparent';
  return (
    <button
      type="button"
      aria-label={props.ariaLabel}
      title={props.ariaLabel}
      aria-pressed={props.pressed}
      onClick={props.onClick}
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        border: props.pressed ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.25)',
        background: none
          ? 'linear-gradient(135deg, #fff 0%, #fff 45%, #d33 45%, #d33 55%, #fff 55%)'
          : props.background,
        cursor: 'pointer',
        padding: 0,
      }}
    />
  );
}

/** The display name of a shape kind (aria labels, the Shape menu). */
export function shapeKindName(kind: ShapeKind): string {
  switch (kind) {
    case 'rect':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'diamond':
      return 'Diamond';
  }
}
