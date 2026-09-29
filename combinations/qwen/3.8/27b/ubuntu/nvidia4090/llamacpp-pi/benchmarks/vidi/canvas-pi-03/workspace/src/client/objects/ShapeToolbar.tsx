import type { ReactElement, SyntheticEvent } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type ShapeFillColor,
  type ShapeStrokeColor,
} from '@/shared/config';

export interface ShapeToolbarProps {
  /** The selected shape's current fill/stroke colour NAMES. */
  fill: ShapeFillColor;
  stroke: ShapeStrokeColor;
  onFill(c: ShapeFillColor): void;
  onStroke(c: ShapeStrokeColor): void;
  onDelete(): void;
}

const FILL_NAMES: readonly ShapeFillColor[] = ['none', 'white', 'blue', 'green', 'yellow', 'pink', 'grey'];
const STROKE_NAMES: readonly ShapeStrokeColor[] = ['dark', 'blue', 'green', 'orange', 'red', 'grey'];

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function swatchStyle(color: string, active: boolean): React.CSSProperties {
  return {
    width: 20,
    height: 20,
    padding: 0,
    borderRadius: 4,
    border: active ? '2px solid rgba(0, 0, 0, 0.6)' : '1px solid rgba(0, 0, 0, 0.2)',
    background: color,
    cursor: 'pointer',
  };
}

/**
 * Floating toolbar for the selected shape (story 10, shape.style): fill
 * swatches (none = transparent), outline swatches and a delete button.
 * Rendered in screen space above the shape by SelectionBar. Swatches carry
 * aria-label "<name> fill" / "<name> outline" (aria-labels, shape.style).
 */
export function ShapeToolbar(props: ShapeToolbarProps): ReactElement {
  const stop = (e: SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape actions"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
      onClick={stop}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        background: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        userSelect: 'none',
      }}
    >
      {FILL_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          aria-label={`${capitalize(name)} fill`}
          title={`${capitalize(name)} fill`}
          aria-pressed={props.fill === name}
          data-testid={`shape-fill-${name}`}
          onClick={() => props.onFill(name)}
          style={swatchStyle(SHAPE_FILL_COLORS[name], props.fill === name)}
        />
      ))}
      <div style={{ width: 1, height: 20, background: 'rgba(0, 0, 0, 0.12)' }} aria-hidden="true" />
      {STROKE_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          aria-label={`${capitalize(name)} outline`}
          title={`${capitalize(name)} outline`}
          aria-pressed={props.stroke === name}
          data-testid={`shape-stroke-${name}`}
          onClick={() => props.onStroke(name)}
          style={swatchStyle(SHAPE_STROKE_COLORS[name], props.stroke === name)}
        />
      ))}
      <div style={{ width: 1, height: 20, background: 'rgba(0, 0, 0, 0.12)' }} aria-hidden="true" />
      <button
        type="button"
        aria-label="Delete shape"
        title="Delete shape"
        data-testid="shape-delete"
        onClick={props.onDelete}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          padding: 0,
          borderRadius: 4,
          border: '1px solid rgba(0, 0, 0, 0.2)',
          background: 'transparent',
          cursor: 'pointer',
          color: 'rgba(0, 0, 0, 0.7)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M6 6l1 14h10l1-14" />
          <path d="M10 10v6M14 10v6" />
        </svg>
      </button>
    </div>
  );
}
