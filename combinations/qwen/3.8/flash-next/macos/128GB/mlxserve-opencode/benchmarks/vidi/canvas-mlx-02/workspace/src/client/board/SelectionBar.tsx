// The selection bar (story 7, sel.interaction): what you can do to the selection
// from the mouse, floating just above it.
//
// Two shapes, because they answer two different questions:
//  * several objects selected (or one object of a type without its own toolbar):
//    a count - announced in an aria-live region so a screen reader hears the
//    selection change - and one Delete that removes the whole selection in a
//    single model call (one undo step in story 8);
//  * exactly one sticky note: the note's own story 2 toolbar (colour swatches and
//    delete), because recolouring is a sticky-specific action and the sticky is
//    the only thing selected.
//
// Like the outlines, it is drawn in SCREEN pixels above the board and placed with
// `worldToScreen`, so it stays the same size at every zoom and never covers the
// objects it belongs to.
import type React from 'react';
import { worldToScreen, type Camera } from '../canvas/camera.ts';

// The screen-space gap between the selection box and the bar that floats above
// it. It is a screen offset, so it does not shrink when the board is zoomed in.
const BAR_GAP_PX = 10;
import { objectBounds, type ObjectSnapshot, type StickySnapshot } from '../../shared/board-model.ts';
import { unionRects } from '../../shared/geometry.ts';
import { NoteToolbar } from '../objects/NoteToolbar.tsx';
import { TextToolbar } from '../objects/TextToolbar.tsx';
import { DEFAULT_TEXT_SIZE } from '../../shared/config.ts';
import type { StickyColor, TextSize } from '../../shared/config.ts';

export interface SelectionBarProps {
  /** the selected ids; nothing is rendered while it is empty */
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  /** where to put the bar: the selection's box projected through this */
  camera: Camera;
  /** remove the whole selection (the model call and the clear are the caller's) */
  onDelete(): void;
  /** sticky-only: recolour the single selected note */
  onColor?(id: string, color: StickyColor): void;
  /**
   * text-only (story 9): choose the font size of the single selected text.
   * The bar asks; the caller owns the model call and its undo boundaries.
   */
  onTextSize?(id: string, size: TextSize): void;
  /**
   * True while one of the selected objects has its text editor open. Story 2
   * kept its toolbar off a note being typed into; the bar stands down the same
   * way, so nothing floats over the words you are writing.
   */
  editing?: boolean;
}

export function SelectionBar(props: SelectionBarProps): React.JSX.Element | null {
  const { ids, snapshot, camera, onDelete, onColor, onTextSize, editing } = props;
  if (ids.size === 0 || editing) return null;
  const selected = snapshot.filter((obj) => ids.has(obj.id));
  if (selected.length === 0) return null; // every id is gone: the prune is on its way
  const box = unionRects(selected.map(objectBounds));
  if (box === null) return null;

  const anchor = worldToScreen(camera, { x: box.x + box.width / 2, y: box.y });
  const wrapper: React.CSSProperties = {
    position: 'fixed',
    left: `${anchor.x}px`,
    top: `${anchor.y - BAR_GAP_PX}px`,
    transform: 'translate(-50%, -100%)',
    zIndex: 30,
    pointerEvents: 'none',
  };

  // One sticky note selected: its own toolbar, not the selection bar.
  if (selected.length === 1 && selected[0].type === 'sticky') {
    const note = selected[0] as StickySnapshot;
    return (
      <div data-testid="selection-toolbar" style={wrapper}>
        <div style={{ pointerEvents: 'auto' }}>
          <NoteToolbar
            color={note.color ?? 'yellow'}
            onColor={(c: StickyColor) => onColor?.(note.id, c)}
            onDelete={onDelete}
          />
        </div>
      </div>
    );
  }

  // One free text selected (story 9): its size toolbar takes the bar's place,
  // exactly the way the note's colour toolbar does - same anchor, same rules.
  if (selected.length === 1 && selected[0].type === 'text') {
    const textObj = selected[0];
    return (
      <div data-testid="selection-toolbar" style={wrapper}>
        <div style={{ pointerEvents: 'auto' }}>
          <TextToolbar
            size={textObj.size ?? DEFAULT_TEXT_SIZE}
            onSize={(s: TextSize) => onTextSize?.(textObj.id, s)}
            onDelete={onDelete}
          />
        </div>
      </div>
    );
  }

  return (
    <div data-testid="selection-bar" data-selection-count={selected.length} style={wrapper}>
      <div
        role="toolbar"
        aria-label="Selection"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 6px 4px 10px',
          background: '#ffffff',
          border: '1px solid #e2e2e2',
          borderRadius: 8,
          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 13,
          color: '#202020',
          pointerEvents: 'auto',
        }}
      >
        {/* A live region, so the count is spoken when it changes rather than only
            being read by someone who happens to focus the bar. */}
        <span aria-live="polite" role="status" data-testid="selection-count">
          {selected.length} selected
        </span>
        <button
          type="button"
          aria-label="Delete selection"
          onClick={onDelete}
          style={{
            border: '1px solid #e2e2e2',
            background: '#fafafa',
            borderRadius: 6,
            padding: '2px 8px',
              fontFamily: 'inherit',
            fontSize: 'inherit',
            cursor: 'pointer',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
