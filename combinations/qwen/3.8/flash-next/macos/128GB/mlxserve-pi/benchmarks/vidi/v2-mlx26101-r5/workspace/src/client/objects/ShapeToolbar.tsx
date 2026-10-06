/**
 * The toolbar of the selected shape: what it is filled with, and what its outline is drawn in.
 *
 * It is the note's palette with the second row added. A note has one colour because a note is one thing —
 * paper, and the colour is the paper — and a shape is two: an inside and an edge, and the reason the PRD
 * asks for both is that a diagram is read by telling one box from another, which is mostly done with an
 * edge. So there are two rows, and each of them changes exactly one of the two keys in the document:
 * filling a shape with blue leaves its label, its size, its place and its selection where they were,
 * because it writes `fill` and nothing else.
 *
 * Like the note's, it is rendered inside the object and counter-scaled by `--inv-zoom`, so it stays the
 * same size on the screen whatever the board is scaled to, and it swallows pointer and wheel events so
 * that clicking a swatch never reaches the board behind it — which would pan the board and drop the
 * selection, and a toolbar that deselects the thing it is a toolbar for is a toolbar that cannot be used.
 */

import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';
import { isFillColor, isStrokeColor } from '../../shared/objects/shape';

/** The names of the seven fill swatches, in the order they are offered. */
export const FILL_NAMES = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
/** The names of the six outline swatches, in the order they are offered. */
export const STROKE_NAMES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

/** The words each fill swatch is called by. `none` is not a colour, so it is not called one. */
export const fillLabel = (name: FillColor): string =>
  name === 'none' ? 'No fill' : `${name[0]?.toUpperCase() ?? ''}${name.slice(1)} fill`;

/** The words each outline swatch is called by. */
export const strokeLabel = (name: StrokeColor): string =>
  `${name[0]?.toUpperCase() ?? ''}${name.slice(1)} outline`;

export interface ShapeToolbarProps {
  /** The selected shape's fill: its swatch is the pressed one. */
  fill: string;
  /** The selected shape's outline: its swatch is the pressed one. */
  stroke: string;
  onFill(color: FillColor): void;
  onStroke(color: StrokeColor): void;
}

/**
 * Six fills, "no fill", and six outlines.
 *
 * The pressed swatch is the shape's own colour, which is why the two rows are asked separately: a shape
 * that is blue on the inside and dark on the edge has one lit swatch in each row, and a document holding
 * a colour from a bigger palette than this one has no lit swatch at all — which is the truth, and better
 * than lighting a swatch that would change the shape if clicked.
 */
export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps): React.JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement> | ReactWheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };
  return (
    <div
      aria-label="Shape toolbar"
      className="shape-toolbar"
      data-testid="shape-toolbar"
      role="toolbar"
      onClick={stop}
      onDoubleClick={stop}
      onPointerCancel={stop}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onWheel={stop}
    >
      <div className="shape-toolbar-row" data-testid="shape-fill-row">
        {FILL_NAMES.map((name) => (
          <button
            key={name}
            aria-label={fillLabel(name)}
            aria-pressed={isFillColor(name) && name === fill}
            className={`shape-swatch shape-fill-${name}`}
            data-testid={`fill-${name}`}
            style={{ background: SHAPE_FILL_COLORS[name] }}
            title={fillLabel(name)}
            type="button"
            onClick={() => {
              onFill(name);
            }}
          />
        ))}
      </div>
      <div className="shape-toolbar-row" data-testid="shape-stroke-row">
        {STROKE_NAMES.map((name) => (
          <button
            key={name}
            aria-label={strokeLabel(name)}
            aria-pressed={isStrokeColor(name) && name === stroke}
            className={`shape-swatch shape-stroke-${name}`}
            data-testid={`stroke-${name}`}
            style={{ background: SHAPE_STROKE_COLORS[name] }}
            title={strokeLabel(name)}
            type="button"
            onClick={() => {
              onStroke(name);
            }}
          />
        ))}
      </div>
    </div>
  );
}
