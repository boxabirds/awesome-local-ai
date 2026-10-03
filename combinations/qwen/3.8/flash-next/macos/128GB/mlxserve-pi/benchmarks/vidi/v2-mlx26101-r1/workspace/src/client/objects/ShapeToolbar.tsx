// The style toolbar of one selected shape (story 10, shape.style).
//
// It is the note toolbar's shape: it floats above the object that owns it, stops every
// pointer event so touching it never pans the board or drags the shape, and its buttons
// are named by what they do rather than by their colour alone — a person who cannot
// tell #BBDEFB from #C8E6C9 still gets "light blue fill" from the accessible name.
//
// Seven fills (six colours and 'no fill', because a shape you cannot see through is a
// worse board) and six outlines. The swatch that matches the shape's current style is
// pressed, which is what lets a person see what a shape already is. Every button writes
// one style key through `shape.setStyle`; the bin deletes through the board's one delete
// path, which is also what detaches any arrow that pointed at the shape.

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_KIND_NAMES,
  SHAPE_NO_FILL_LABEL,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from '../../shared/config';

export interface ShapeToolbarProps {
  /** Only for the toolbar's own accessible description; it changes nothing about paint. */
  kind?: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  onFill(fill: FillColor): void;
  onStroke(stroke: StrokeColor): void;
  onDelete(): void;
}

const FILLS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

/** 'blue' → 'Blue'; the one swatch whose name is a phrase lives in config. */
function displayName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function fillLabel(fill: FillColor): string {
  return fill === 'none' ? SHAPE_NO_FILL_LABEL : `${displayName(fill)} fill`;
}

export function strokeLabel(stroke: StrokeColor): string {
  return `${displayName(stroke)} outline`;
}

const swatchBase: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 4,
  border: '1px solid rgba(0,0,0,0.25)',
  padding: 0,
  cursor: 'pointer',
  display: 'inline-block',
};

/** The shape's own toolbar: fills, outlines, bin. Shown when it is the sole selection. */
export function ShapeToolbar({ kind, fill, stroke, onFill, onStroke, onDelete }: ShapeToolbarProps) {
  const stop = (e: ReactPointerEvent) => e.stopPropagation();
  const describe = kind ? `${SHAPE_KIND_NAMES[kind]} style` : 'Shape style';
  return (
    <div
      className="note-toolbar shape-toolbar"
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label={describe}
      onPointerDown={stop}
      style={{
        position: 'absolute',
        left: 0,
        top: -44,
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        background: '#fff',
        border: '1px solid #e2e4ea',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
      }}
    >
      {FILLS.map((name) => {
        const pressed = name === fill;
        return (
          <button
            key={name}
            type="button"
            aria-label={fillLabel(name)}
            title={fillLabel(name)}
            aria-pressed={pressed}
            data-testid={`shape-fill-${name}`}
            onClick={() => onFill(name)}
            style={{
              ...swatchBase,
              // 'none' is drawn as a blank swatch with a diagonal: visible as a choice
              // without being a colour of its own.
              background:
                name === 'none'
                  ? 'repeating-linear-gradient(45deg, #fff 0 4px, #f0f1f5 4px 5px)'
                  : SHAPE_FILL_COLORS[name],
              outline: pressed ? '2px solid #1b1d23' : 'none',
            }}
          />
        );
      })}
      <span aria-hidden="true" style={{ width: 1, height: 20, background: '#e2e4ea', margin: '0 2px' }} />
      {STROKES.map((name) => {
        const pressed = name === stroke;
        return (
          <button
            key={name}
            type="button"
            aria-label={strokeLabel(name)}
            title={strokeLabel(name)}
            aria-pressed={pressed}
            data-testid={`shape-stroke-${name}`}
            onClick={() => onStroke(name)}
            style={{
              ...swatchBase,
              background: '#fff',
              border: `3px solid ${SHAPE_STROKE_COLORS[name]}`,
              outline: pressed ? '2px solid #1b1d23' : 'none',
            }}
          />
        );
      })}
      <button
        type="button"
        aria-label="Delete shape"
        title="Delete shape"
        data-testid="shape-delete"
        onClick={onDelete}
        style={{
          marginLeft: 2,
          border: '1px solid #d0d3da',
          background: '#fff',
          borderRadius: 4,
          height: 20,
          cursor: 'pointer',
          fontSize: 13,
          lineHeight: 1,
          padding: '0 6px',
        }}
      >
        🗑
      </button>
    </div>
  );
}
