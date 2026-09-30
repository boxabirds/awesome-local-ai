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
import type { StickyColor } from '../../shared/config';
import { worldToScreen } from '../canvas/camera';
import { useBoardCamera } from '../canvas/BoardViewport';
import { NoteToolbar } from '../objects/NoteToolbar';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly BoardObject[];
  doc: Y.Doc;
  /** Delete everything selected — the model call and the cleanup are the board's. */
  onDelete(): void;
}

/** How many objects are selected, in the words the bar says out loud. */
export const selectionCountLabel = (count: number): string =>
  `${count} selected`;

// Approximate size of the bar, for keeping it inside the window. The bar has no layout
// to measure in a test environment, and being roughly right is enough: what matters is
// that it is never placed off the edge of the screen where nothing can reach it.
const TOOLBAR_WIDTH_PX = 200;
const BAR_WIDTH_PX = 160;
const BAR_HEIGHT_PX = 28;
const EDGE_INSET_PX = 8;

const windowSize = (): { width: number; height: number } => ({
  width: typeof window === 'undefined' ? 1280 : window.innerWidth,
  height: typeof window === 'undefined' ? 800 : window.innerHeight,
});

export function SelectionBar({ ids, snapshot, doc, onDelete }: SelectionBarProps): ReactNode {
  const { camera } = useBoardCamera();
  const selected = snapshot.filter((object) => ids.has(object.id));
  if (selected.length === 0) return null;

  // One sticky note gets its own tools — the colour swatches and the bin — rather than
  // a count of one. Anything else, and anything from two objects up, gets the bar.
  const loneSticky = selected.length === 1 && isStickySnapshot(selected[0]) ? selected[0] : undefined;

  const box = selectionBounds(snapshot, [...ids]);
  const anchor = box ? worldToScreen(camera, { x: box.x, y: box.y }) : { x: 0, y: 0 };
  const width = loneSticky ? TOOLBAR_WIDTH_PX : BAR_WIDTH_PX;
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
            setStickyColor(doc, loneSticky.id, color);
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
