// The fill and outline swatches of one selected shape (story 10 `shape.ui`).
//
// Two rows of swatches — seven fills (six colours plus "no fill") and six outlines —
// each named so it is findable by name and not by colour alone: `button[aria-label=
// "<colour> fill"]` and `button[aria-label="<colour> outline"]`. The pressed swatch is
// the colour the shape has now. A swatch click writes only that one field
// (`setShapeStyle`), so the label, the size and the selection are left exactly as they
// were (TC-17), and each click is fenced as its own undo step.
//
// Like every toolbar it is rendered in screen space and stops its own pointer, click
// and wheel events, so choosing a colour never reaches the board underneath.

import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config.ts';
import { useUndoBoundary } from '../board/useUndo.ts';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
  /** Remove the shape; omitted by a caller that cannot delete. */
  onDelete?(): void;
  /** False on a board that could not be loaded: the swatches are inert. */
  canEdit?: boolean;
}

const SWATCH: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: '50%',
  border: '1px solid rgba(0,0,0,0.2)',
  cursor: 'pointer',
  padding: 0,
};

const FILL_KEYS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKE_KEYS = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

function label(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * A selected shape's floating toolbar: fill swatches, outline swatches, delete.
 */
export function ShapeToolbar(props: ShapeToolbarProps) {
  const stop = (e: React.PointerEvent | React.MouseEvent | React.WheelEvent) =>
    e.stopPropagation();
  const boundary = useUndoBoundary();
  const canEdit = props.canEdit ?? true;
  const pickFill = (c: FillColor) => {
    boundary();
    props.onFill(c);
    boundary();
  };
  const pickStroke = (c: StrokeColor) => {
    boundary();
    props.onStroke(c);
    boundary();
  };
  const remove = () => {
    boundary();
    props.onDelete?.();
    boundary();
  };
  return (
    <div
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape options"
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onWheel={stop}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#ffffff',
        border: '1px solid #d6d9de',
        borderRadius: 8,
        padding: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
      }}
    >
      <span data-testid="shape-fill-row" style={{ display: 'flex', gap: 4 }}>
        {FILL_KEYS.map((name) => {
          const active = props.fill === name;
          return (
            <button
              key={name}
              type="button"
              aria-label={`${label(name)} fill`}
              data-testid={`shape-fill-${name}`}
              title={`${label(name)} fill`}
              aria-pressed={active}
              disabled={!canEdit}
              onClick={() => pickFill(name)}
              style={{
                ...SWATCH,
                background: SHAPE_FILL_COLORS[name],
                cursor: canEdit ? 'pointer' : 'not-allowed',
                outline: active ? '2px solid #2f6fed' : undefined,
                outlineOffset: 1,
              }}
            />
          );
        })}
      </span>
      <span aria-hidden style={{ width: 1, height: 20, background: '#d6d9de' }} />
      <span data-testid="shape-stroke-row" style={{ display: 'flex', gap: 4 }}>
        {STROKE_KEYS.map((name) => {
          const active = props.stroke === name;
          return (
            <button
              key={name}
              type="button"
              aria-label={`${label(name)} outline`}
              data-testid={`shape-stroke-${name}`}
              title={`${label(name)} outline`}
              aria-pressed={active}
              disabled={!canEdit}
              onClick={() => pickStroke(name)}
              style={{
                ...SWATCH,
                background: SHAPE_STROKE_COLORS[name],
                cursor: canEdit ? 'pointer' : 'not-allowed',
                outline: active ? '2px solid #2f6fed' : undefined,
                outlineOffset: 1,
              }}
            />
          );
        })}
      </span>
      <button
        type="button"
        aria-label="Delete shape"
        data-testid="shape-delete"
        title="Delete shape"
        onClick={remove}
        style={{
          width: 22,
          height: 22,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 15,
          lineHeight: '22px',
          color: '#b3261e',
        }}
      >
        <span aria-hidden>&#128465;</span>
      </button>
    </div>
  );
}
