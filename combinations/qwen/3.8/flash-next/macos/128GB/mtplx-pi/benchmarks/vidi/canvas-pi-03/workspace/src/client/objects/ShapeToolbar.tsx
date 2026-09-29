import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor } from '../../shared/config';

export interface ShapeToolbarProps {
  /** The shape's current fill key ('none' draws no fill at all). */
  fill: FillColor;
  /** The shape's current outline key. */
  stroke: StrokeColor;
  /** A fill swatch was clicked. */
  onFill(c: FillColor): void;
  /** An outline swatch was clicked. */
  onStroke(c: StrokeColor): void;
  /** True while the board cannot be edited: every swatch is disabled. */
  disabled?: boolean;
}

/** 'none' is a fill in the data model but not a colour on screen, so it gets
 * its own accessible name instead of the misleading "none fill". */
function fillLabel(key: FillColor): string {
  return key === 'none' ? 'No fill' : `${key} fill`;
}

function capital(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function Swatch({
  label,
  colour,
  active,
  disabled,
  onClick,
}: {
  label: string;
  colour: string;
  active: boolean;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      data-testid="shape-swatch"
      onClick={onClick}
      style={{
        width: 20,
        height: 20,
        padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        // A no-fill swatch still needs an edge, or it is invisible.
        border: active ? '2px solid #2563eb' : '1px solid rgba(0,0,0,0.35)',
        borderRadius: 4,
        background: colour,
        opacity: disabled ? 0.4 : 1,
      }}
    />
  );
}

/**
 * The floating style bar for a selected shape: fill swatches (six colours plus
 * no fill) and outline swatches (six colours).
 *
 * Colour is never the only signal: every swatch carries its colour name in its
 * accessible label and reports its own state through `aria-pressed`, and the
 * two groups are separated by a text heading so a screen reader says "Fill" or
 * "Outline" before the colour. Pointer events stop here: a click in the bar is
 * a recolour, never a click-through that would clear the selection.
 */
export function ShapeToolbar({ fill, stroke, onFill, onStroke, disabled = false }: ShapeToolbarProps) {
  return (
    <div
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape style"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: 4,
        background: '#ffffff',
        border: '1px solid rgba(17,17,17,0.12)',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        fontSize: 11,
      }}
    >
      <span aria-hidden="true" style={{ color: '#666' }}>
        Fill
      </span>
      {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((key) => (
        <Swatch
          key={key}
          label={fillLabel(key)}
          colour={SHAPE_FILL_COLORS[key]}
          active={key === fill}
          disabled={disabled}
          onClick={() => onFill(key)}
        />
      ))}
      <span
        aria-hidden="true"
        style={{ width: 1, height: 20, background: 'rgba(17,17,17,0.15)', margin: '0 2px' }}
      />
      <span aria-hidden="true" style={{ color: '#666' }}>
        Outline
      </span>
      {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((key) => (
        <Swatch
          key={key}
          label={`${capital(key)} outline`}
          colour={SHAPE_STROKE_COLORS[key]}
          active={key === stroke}
          disabled={disabled}
          onClick={() => onStroke(key)}
        />
      ))}
    </div>
  );
}
