// The one bar that acts on the selection (`sel.interaction`).
//
// Story 2 put a toolbar on each note. With a selection that can hold forty objects of
// several kinds that does not work any more, so the tools moved out to a single bar
// above the board: a count and a delete for anything from two objects up, and the
// note's own colour toolbar when the selection is exactly one sticky note. Either way
// there is one place on the screen where the selected things can be acted on, and it
// is the same place for one object as for many.
//
// It is rendered in screen space (as viewport chrome), so it stays the same size
// however far the board is zoomed, and it is clamped into the window so it is always
// reachable.
import type { CSSProperties, ReactNode } from 'react';
import type * as Y from 'yjs';
import type { BoardObject } from '../../shared/board-model';
import { isStickySnapshot, selectionBounds, setStickyColor } from '../../shared/board-model';
import type { ShapeFill, ShapeStroke, StickyColor, TextSize } from '../../shared/config';
import { isShapeSnapshot, setShapeStyle } from '../../shared/objects/shape';
import { isTextSnapshot } from '../../shared/objects/text';
import { worldToScreen } from '../canvas/camera';
import { useBoardCamera } from '../canvas/BoardViewport';
import { NoteToolbar } from '../objects/NoteToolbar';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { boardMeasurer } from '../objects/textLayout';
import { applyTextSize } from '../objects/useTextBoxSync';
import type { UndoController } from './undo';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly BoardObject[];
  doc: Y.Doc;
  /** Delete everything selected — the model call and the cleanup are the board's. */
  onDelete(): void;
  /** This tab's undo history (story 8); a colour change is closed into its own step. */
  undo?: UndoController;
}

/** How many objects are selected, in the words the bar says out loud. */
export const selectionCountLabel = (count: number): string =>
  `${count} selected`;

// Approximate size of the bar, for keeping it inside the window. The bar has no layout
// to measure in a test environment, and being roughly right is enough: what matters is
// that it is never placed off the edge of the screen where nothing can reach it.
const TOOLBAR_WIDTH_PX = 200;
const TEXT_TOOLBAR_WIDTH_PX = 190;
// Thirteen swatches in two groups: the widest bar the rail ever shows.
const SHAPE_TOOLBAR_WIDTH_PX = 320;
const BAR_WIDTH_PX = 160;
const BAR_HEIGHT_PX = 28;
const EDGE_INSET_PX = 8;

const windowSize = (): { width: number; height: number } => ({
  width: typeof window === 'undefined' ? 1280 : window.innerWidth,
  height: typeof window === 'undefined' ? 800 : window.innerHeight,
});

export function SelectionBar({ ids, snapshot, doc, onDelete, undo }: SelectionBarProps): ReactNode {
  const { camera } = useBoardCamera();
  const selected = snapshot.filter((object) => ids.has(object.id));
  if (selected.length === 0) return null;

  // One sticky note gets its own tools — the colour swatches and the bin — rather than
  // a count of one. A single piece of text gets its four sizes and the bin. Anything
  // else, and anything from two objects up, gets the bar.
  const loneSticky = selected.length === 1 && isStickySnapshot(selected[0]) ? selected[0] : undefined;
  const loneText = selected.length === 1 && isTextSnapshot(selected[0]) ? selected[0] : undefined;
  // One shape gets its own two groups of swatches: what it is filled with, and what it
  // is outlined in (`shape.style`).
  const loneShape = selected.length === 1 && isShapeSnapshot(selected[0]) ? selected[0] : undefined;

  const box = selectionBounds(snapshot, [...ids]);
  const anchor = box ? worldToScreen(camera, { x: box.x, y: box.y }) : { x: 0, y: 0 };
  const width = loneSticky
    ? TOOLBAR_WIDTH_PX
    : loneText
      ? TEXT_TOOLBAR_WIDTH_PX
      : loneShape
        ? SHAPE_TOOLBAR_WIDTH_PX
        : BAR_WIDTH_PX;
  const view = windowSize();
  const left = Math.min(
    Math.max(EDGE_INSET_PX, anchor.x),
    Math.max(EDGE_INSET_PX, view.width - width - EDGE_INSET_PX),
  );
  const top = Math.min(
    Math.max(EDGE_INSET_PX, anchor.y - BAR_HEIGHT_PX - EDGE_INSET_PX),
    Math.max(EDGE_INSET_PX, view.height - BAR_HEIGHT_PX - EDGE_INSET_PX),
  );

  const style: CSSProperties = {
    position: 'fixed',
    left,
    top,
    zIndex: 3,
    pointerEvents: 'auto',
  };

  if (loneSticky) {
    return (
      <div data-testid="selection-bar" style={style}>
        <NoteToolbar
          color={loneSticky.color}
          onColor={(color: StickyColor): void => {
            // A recolour is one undo step, closed around the single model call.
            undo?.boundary();
            setStickyColor(doc, loneSticky.id, color);
            undo?.boundary();
          }}
          onDelete={onDelete}
        />
      </div>
    );
  }

  if (loneText) {
    return (
      <div data-testid="selection-bar" style={style}>
        <TextToolbar
          size={loneText.size}
          onSize={(size: TextSize): void => {
            // A size change and the box it forces are one undo step: bigger text that
            // gets undone comes back as the size it was, not as a box still too tall.
            undo?.boundary();
            applyTextSize(doc, loneText.id, size, boardMeasurer);
            undo?.boundary();
          }}
          onDelete={onDelete}
        />
      </div>
    );
  }

  if (loneShape) {
    return (
      <div data-testid="selection-bar" style={style}>
        <ShapeToolbar
          fill={loneShape.fill}
          stroke={loneShape.stroke}
          onFill={(fill: ShapeFill): void => {
            // One swatch, one key of the shape, one undo step: the label, the size and
            // the selection are untouched by a change of colour.
            undo?.boundary();
            setShapeStyle(doc, loneShape.id, { fill });
            undo?.boundary();
          }}
          onStroke={(stroke: ShapeStroke): void => {
            undo?.boundary();
            setShapeStyle(doc, loneShape.id, { stroke });
            undo?.boundary();
          }}
          onDelete={onDelete}
        />
      </div>
    );
  }

  return (
    <div data-testid="selection-bar" role="toolbar" aria-label="Selection" style={style}>
      <span data-testid="selection-count" aria-live="polite" style={countStyle}>
        {selectionCountLabel(selected.length)}
      </span>
      <button
        type="button"
        data-testid="delete-selection"
        aria-label="Delete selection"
        style={buttonStyle}
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}

const countStyle: CSSProperties = {
  display: 'inline-block',
  padding: '4px 8px',
  backgroundColor: '#1f2328',
  color: '#ffffff',
  borderRadius: 4,
  fontSize: 12,
  fontFamily: 'var(--vidi6-font)',
  marginRight: 6,
};

const buttonStyle: CSSProperties = {
  padding: '4px 8px',
  fontSize: 12,
  fontFamily: 'var(--vidi6-font)',
  border: '1px solid #d0d7de',
  borderRadius: 4,
  backgroundColor: '#ffffff',
  cursor: 'pointer',
};
