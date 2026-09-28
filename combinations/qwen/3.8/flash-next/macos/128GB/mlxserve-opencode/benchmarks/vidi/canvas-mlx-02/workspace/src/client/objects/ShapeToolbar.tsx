// The shape's own toolbar (story 10, shape.palette), shown by the selection bar
// in place of the "N selected" count when exactly one shape is selected - the
// same arrangement the sticky note's colour bar and the text's size bar made.
//
// Two groups, because the two settings are different questions: what is the shape
// filled WITH, and what line goes round it. Both are palette NAMES: this file
// turns a name into a colour to paint a swatch, and hands the name straight back
// to the caller - it never converts a name to a hex value for the document, which
// is what lets a later story add a colour by adding one entry to the table.
//
// 'none' is an ordinary member of the fill palette (a shape with no fill is a
// legitimate shape), so it is a swatch like any other and is stored as the name
// 'none'; the outline palette has no 'none' entry, so no swatch is offered for it
// and an outline is always one of the five colours.
import type React from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from '../../shared/config.ts';
import type { FillColor, StrokeColor } from '../../shared/config.ts';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(f: FillColor): void;
  onStroke(s: StrokeColor): void;
  /** the selection's Delete; omitted when the caller has no delete to offer */
  onDelete?(): void;
}

const FILL_NAMES = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKE_NAMES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

const SWATCH = 18;

function swatchStyle(background: string, selected: boolean): React.CSSProperties {
  return {
    width: SWATCH,
    height: SWATCH,
    padding: 0,
    borderRadius: 4,
    cursor: 'pointer',
    background,
    border: selected ? '2px solid #202020' : '1px solid #bdbdbd',
    boxSizing: 'border-box',
    position: 'relative',
  };
}

// A swatch for a palette entry. `background` is the colour the name paints;
// `slash` draws the diagonal that means "nothing at all" for the 'none' entry.
function Swatch(props: {
  testId: string;
  label: string;
  background: string;
  selected: boolean;
  slash: boolean;
  onPress(): void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.selected}
      onClick={props.onPress}
      data-testid={props.testId}
      style={swatchStyle(props.background, props.selected)}
    >
      {props.slash ? (
        <svg width={SWATCH} height={SWATCH} viewBox={`0 0 ${SWATCH} ${SWATCH}`} style={{ display: 'block' }} aria-hidden="true">
          <line
            x1={1}
            y1={SWATCH - 1}
            x2={SWATCH - 1}
            y2={1}
            stroke="#b00020"
            strokeWidth={1.5}
            data-testid={`${props.testId}-slash`}
          />
        </svg>
      ) : null}
    </button>
  );
}

const GROUP_LABEL: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.04em',
  color: '#8a8a8a',
  textTransform: 'uppercase',
  marginRight: 2,
};

export function ShapeToolbar(props: ShapeToolbarProps): React.JSX.Element {
  const { fill, stroke, onFill, onStroke, onDelete } = props;
  return (
    <div
      data-testid="shape-toolbar"
      role="group"
      aria-label="Shape toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: 4,
        background: '#ffffff',
        border: '1px solid #e2e2e2',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <span style={GROUP_LABEL}>Fill</span>
      <span data-testid="shape-fills" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {FILL_NAMES.map((name) => (
          <Swatch
            key={name}
            testId={`shape-fill-${name}`}
            label={`${name} fill`}
            background={SHAPE_FILL_COLORS[name]}
            selected={name === fill}
            slash={name === 'none'}
            onPress={() => onFill(name)}
          />
        ))}
      </span>
      <span
        aria-hidden="true"
        style={{ width: 1, height: 18, background: '#e8e8e8', margin: '0 2px' }}
      />
      <span style={GROUP_LABEL}>Line</span>
      <span data-testid="shape-strokes" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {STROKE_NAMES.map((name) => (
          <Swatch
            key={name}
            testId={`shape-stroke-${name}`}
            label={`${name} outline`}
            background={SHAPE_STROKE_COLORS[name]}
            selected={name === stroke}
            slash={false}
            onPress={() => onStroke(name)}
          />
        ))}
      </span>
      {onDelete ? (
        <button
          type="button"
          aria-label="Delete shape"
          title="Delete shape"
          onClick={onDelete}
          data-testid="shape-delete"
          style={{
            marginLeft: 2,
            width: 22,
            height: 18,
            padding: 0,
            borderRadius: 4,
            cursor: 'pointer',
            border: '1px solid #d0d0d0',
            background: '#fff',
            lineHeight: 1,
            fontSize: 13,
            color: '#b00020',
          }}
        >
          🗑
        </button>
      ) : null}
    </div>
  );
}
