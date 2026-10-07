import type { JSX } from 'react';

import type { FillColor, StrokeColor, TextSize } from '../../shared/config.js';
import type { ShapeSnap } from '../../shared/objects/shape.js';
import { TextToolbar } from './TextToolbar.js';
import { ShapeToolbar } from './ShapeToolbar.js';

/**
 * The bar that floats over the selection
 * (`src/client/objects/SelectionBar.tsx`).
 *
 * A single selected sticky shows *its own* toolbar (the note already owns the
 * colour/delete/edit controls, and there is one of it). Two or more selected
 * objects show this bar instead: the count of the selection - announced to a
 * screen reader, because "did my marquee actually grab those?" is invisible to a
 * non-visual user - and one Delete action that works on the whole selection.
 *
 * Story 9 added a third case, because a piece of text is the first object with
 * nothing of its own to draw: a lone selected text object gets this bar too, with
 * its size buttons and Delete in it. The bar is the board saying "this is what you
 * have selected, and here is what you can do to it", which is a sentence worth
 * saying whether the thing in it has a colour or not.
 *
 * It is otherwise deliberately minimal. Group actions that arrive with later
 * stories (colour across a selection, alignment, grouping, z-order) extend this
 * bar; story 9 ships only what its own acceptance needs.
 */

export interface SelectionBarProps {
  /** How many objects are selected. */
  count: number;
  /** Delete every selected object (kept as one user action). */
  onDelete(): void;
  /**
   * The size of the selected object, when the selection is exactly one text object
   * - which is the only selection that gets a text toolbar rather than a count.
   * Anything else (nothing, a note, a group) passes nothing.
   */
  textSize?: TextSize | null;
  /** Make the selected text object that size (and let its box be measured again). */
  onTextSize?(size: TextSize): void;
  /**
   * The shape that is selected on its own, when it is - which is the other selection
   * that gets a toolbar of its own rather than a count. A story 9's text is an object
   * with nothing to draw, and a shape is an object with two colours to choose, and
   * both are things a person selects one of at a time.
   */
  shape?: ShapeSnap | null;
  /** Give the selected shape that fill and/or that outline. */
  onShapeStyle?(style: { fill?: FillColor; stroke?: StrokeColor }): void;
}

export default function SelectionBar({
  count,
  onDelete,
  textSize = null,
  onTextSize,
  shape = null,
  onShapeStyle,
}: SelectionBarProps): JSX.Element | null {
  // A lone shape gets its colours; the check is on the object rather than on a
  // colour being set, because a shape whose fill is 'none' is still a shape.
  if (count === 1 && shape !== null && onShapeStyle !== undefined) {
    return (
      <div
        className="selection-bar"
        role="toolbar"
        aria-label="Selection"
        data-testid="selection-bar"
        data-shape-object-selection="true"
      >
        <ShapeToolbar
          fill={shape.fill}
          stroke={shape.stroke}
          onFill={(colour) => onShapeStyle({ fill: colour })}
          onStroke={(colour) => onShapeStyle({ stroke: colour })}
          onDelete={onDelete}
        />
      </div>
    );
  }

  // A lone object that has its own toolbar uses it, not this bar; nothing selected
  // shows nothing at all.
  if (count === 1 && textSize !== null && onTextSize) {
    return (
      <div
        className="selection-bar"
        role="toolbar"
        aria-label="Selection"
        data-testid="selection-bar"
        data-text-object-selection="true"
      >
        <TextToolbar size={textSize} onSize={onTextSize} onDelete={onDelete} />
      </div>
    );
  }

  if (count < 2) return null;

  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection" data-testid="selection-bar">
      <span className="selection-count" role="status" aria-live="polite" data-testid="selection-count">
        {`${count} selected`}
      </span>
      <button
        type="button"
        className="selection-delete"
        data-testid="selection-delete"
        aria-label="Delete selection"
        title="Delete selection (Delete)"
        onClick={onDelete}
      >
        🗑
      </button>
    </div>
  );
}
