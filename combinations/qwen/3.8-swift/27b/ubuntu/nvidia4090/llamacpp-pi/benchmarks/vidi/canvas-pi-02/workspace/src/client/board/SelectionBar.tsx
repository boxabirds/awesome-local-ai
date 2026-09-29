// Selection bar (story 7, sel.bar): shown above the selection's bounding
// box. For ≥2 selected objects it shows "N selected" (aria-live) and a
// Delete button; for exactly one sticky note it is story 2's NoteToolbar
// (colour + delete); for a single non-sticky object there is nothing yet
// (type toolbars come with stories 9-12).

import type { ReactElement } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { FillColor, StickyColor, StrokeColor, TextSize } from '../../shared/config';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { ShapeToolbar } from '../objects/ShapeToolbar';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  disabled?: boolean;
  onDelete(): void;
  onColor(id: string, color: StickyColor): void;
  /** Story 9: the size of the single selected text object (drives the
   *  TextToolbar); undefined when the selection is not a single text. */
  textSize?: TextSize;
  onTextSize?(id: string, size: TextSize): void;
  /** Story 10: the fill/stroke of the single selected shape (drives the
   *  ShapeToolbar); null when the selection is not a single shape. */
  shapeStyle?: { fill: FillColor; stroke: StrokeColor } | null;
  /** Story 10: change the selected shape's fill and/or stroke. */
  onShapeStyle?(id: string, style: { fill?: FillColor; stroke?: StrokeColor }): void;
}

export function SelectionBar(props: SelectionBarProps): ReactElement | null {
  const objects = props.snapshot.filter((o) => props.ids.has(o.id));
  if (objects.length === 0) return null;

  // Exactly one sticky note: story 2's note toolbar, unchanged.
  if (objects.length === 1) {
    const single = objects[0];
    const color = single.color;
    if (single.type === 'sticky' && color !== undefined) {
      return (
        <NoteToolbar
          color={color}
          disabled={props.disabled}
          onColor={(c) => props.onColor(single.id, c)}
          onDelete={props.onDelete}
        />
      );
    }
    // Story 9: a single text object gets the text toolbar (size + delete).
    if (single.type === 'text' && props.textSize !== undefined && props.onTextSize !== undefined) {
      return (
        <TextToolbar
          size={props.textSize}
          disabled={props.disabled}
          onSize={(s) => props.onTextSize?.(single.id, s)}
          onDelete={props.onDelete}
        />
      );
    }
    // Story 10: a single shape gets the shape toolbar (fill + outline).
    if (single.type === 'shape' && props.shapeStyle !== null && props.shapeStyle !== undefined && props.onShapeStyle !== undefined) {
      return (
        <ShapeToolbar
          fill={props.shapeStyle.fill}
          stroke={props.shapeStyle.stroke}
          disabled={props.disabled}
          onFill={(c) => props.onShapeStyle?.(single.id, { fill: c })}
          onStroke={(c) => props.onShapeStyle?.(single.id, { stroke: c })}
        />
      );
    }
    // A single object of any other type gets no toolbar.
    return null;
  }

  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="selection-bar-count" aria-live="polite">
        {objects.length} selected
      </span>
      <button
        type="button"
        className="selection-bar-delete"
        aria-label="Delete selection"
        title="Delete selection"
        disabled={props.disabled}
        onClick={props.onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M5.5 1.5h5M2.5 4h11M4 4l.7 9.3a1 1 0 0 0 1 .97h4.6a1 1 0 0 0 1-.97L12 4M6.5 7v4M9.5 7v4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
