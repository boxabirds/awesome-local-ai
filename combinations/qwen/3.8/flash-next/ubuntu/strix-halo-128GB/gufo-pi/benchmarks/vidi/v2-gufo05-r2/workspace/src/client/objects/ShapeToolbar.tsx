/**
 * Story 10: the toolbar of one selected shape — its fill and its outline.
 *
 * Six fills and a "no fill", six outlines, in the palettes the settings name. A swatch
 * is a button whose accessible name says the colour it applies ("blue fill", "red
 * outline"), the pressed one is the colour the shape has, and clicking one changes only
 * that one key of the shape: the label, the size, the position and the selection are
 * untouched, because `setShapeStyle` writes only what it is handed.
 */

import type { CSSProperties } from 'react';

import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor } from '../../shared/config';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  /** The board is locked (see `canEdit`): the swatches are shown, not clickable. */
  disabled?: boolean;
  onFill(colour: FillColor): void;
  onStroke(colour: StrokeColor): void;
  /** Shown when there is something to remove: the same control every toolbar offers. */
  onDelete?(): void;
}

/** The swatch colours, in the order the palettes list them. */
export const FILL_SWATCHES = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
export const STROKE_SWATCHES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

export function ShapeToolbar({
  fill,
  stroke,
  disabled = false,
  onFill,
  onStroke,
  onDelete,
}: ShapeToolbarProps) {
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  return (
    <div
      className="shape-toolbar"
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape styles"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      <div className="shape-toolbar__group" role="group" aria-label="Shape fill">
        {FILL_SWATCHES.map((name) => (
          <button
            key={name}
            type="button"
            className="shape-toolbar__swatch"
            data-testid={`shape-fill-${name}`}
            aria-label={`${name} fill`}
            aria-pressed={fill === name}
            disabled={disabled}
            title={`${name} fill`}
            style={{ ['--swatch' as string]: SHAPE_FILL_COLORS[name] } as CSSProperties}
            onClick={() => onFill(name)}
          />
        ))}
      </div>
      <div className="shape-toolbar__group" role="group" aria-label="Shape outline">
        {STROKE_SWATCHES.map((name) => (
          <button
            key={name}
            type="button"
            className="shape-toolbar__swatch shape-toolbar__swatch--stroke"
            data-testid={`shape-stroke-${name}`}
            aria-label={`${name} outline`}
            aria-pressed={stroke === name}
            disabled={disabled}
            title={`${name} outline`}
            style={{ ['--swatch' as string]: SHAPE_STROKE_COLORS[name] } as CSSProperties}
            onClick={() => onStroke(name)}
          />
        ))}
      </div>
      {onDelete ? (
        <button
          type="button"
          className="shape-toolbar__delete"
          aria-label="Delete shape"
          title="Delete shape"
          data-testid="delete-selected"
          disabled={disabled}
          onClick={onDelete}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M6 2h4l.7.7H13v1.5H3V2.7h2.3L6 2Zm-1 4h6l-.5 8h-5L5 6Z" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
