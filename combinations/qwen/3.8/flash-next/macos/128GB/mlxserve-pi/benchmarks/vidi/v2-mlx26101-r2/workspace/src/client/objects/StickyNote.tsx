import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import { deleteObjects, getStickyText, setStickyColor, type StickySnapshot } from '../../shared/board-model.js';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_PADDING_WORLD,
  type StickyColor,
} from '../../shared/config.js';
import { NoteToolbar } from './NoteToolbar.js';
import { fitFontSize } from './StickyText.js';
import { StickyTextEditor } from './StickyTextEditor.js';
import type { ObjectProps } from './registry.js';

/**
 * One sticky note on the board (design anchor `sticky.component`,
 * `sticky.interaction`) - the component the object registry points at for the
 * `sticky` type.
 *
 * Story 7 moved the drag out of here and into the shared transform gesture: a
 * note that is dragged may be one of many moving together, so the note no longer
 * runs its own drag state machine. It hands the pointer to
 * `gesture.onObjectPointerDown` (which moves the whole selection and writes the
 * document), and reads back only whether *it* is currently being dragged, for the
 * `data-dragging` affordance. Everything still genuinely local to one note lives
 * here: its auto-fit text, its colour, and its toolbar.
 *
 * The toolbar shows only when this note is the *whole* selection (a multi-select
 * gets the selection bar instead), and never while dragging or editing. Selection
 * and editing live in `useSelection` at the board level, so clicking empty space
 * can clear them and the note just reflects what it is told through props.
 */

/** The toolbar shows for a note that is the only thing selected. */
function showsOwnToolbar(props: ObjectProps): boolean {
  return props.selected && props.selectionSize === 1 && !props.editing;
}

export function StickyNote(props: ObjectProps): JSX.Element {
  const { object, doc, zoom, selected, editing, canEdit = true, selection, gesture, selectionSize } =
    props;
  const sticky = object as StickySnapshot;

  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  const noteElementRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);

  // Whether *this* note is part of an in-progress move/resize; the gesture owns it.
  const dragging = gesture.draggingIds.has(object.id);

  /** The note's shared text; `undefined` only in the moment before removal. */
  const ytext = getStickyText(doc, object.id);

  /**
   * Auto-fit (sticky.text_fit): the largest integer font size the text still fits
   * at. Measured in board units, so a zoom change needs no remeasurement.
   */
  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;
    const box =
      measure.clientHeight > 0
        ? measure.clientHeight
        : STICKY_SIZE_WORLD - 2 * STICKY_TEXT_PADDING_WORLD;
    const next = fitFontSize(measure, box);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [sticky.text]);

  // Nothing to tear down on unmount any more: the drag lives in the gesture hook
  // (in the board surface), so a note deleted mid-drag simply stops being drawn,
  // and the gesture skips the id that is gone (TC-37).
  useEffect(() => undefined, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // The gesture selects, toggles (Shift), and starts the group move; it also
      // stops propagation so the board behind the note never pans (sticky.no_pan).
      gesture.onObjectPointerDown(event, object.id);
    },
    [gesture, object.id],
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // A double-click edits this note; it never creates one, and never reaches
      // the viewport (which would).
      event.stopPropagation();
      if (editing || !canEdit) return;
      selection.startEdit(object.id);
    },
    [editing, canEdit, selection, object.id],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // Enter on a focused note edits it; the board-level handler covers the case
      // where focus is elsewhere.
      if (event.key === 'Enter' && !editing) {
        event.preventDefault();
        if (canEdit) selection.startEdit(object.id);
      }
    },
    [editing, canEdit, selection, object.id],
  );

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (!canEdit) return;
      setStickyColor(doc, object.id, color);
    },
    [canEdit, doc, object.id],
  );

  const handleDelete = useCallback(() => {
    if (!canEdit) return;
    // Deleting the note deletes the whole selection it belongs to (the toolbar
    // only shows for a lone note, so this is that one note), then clears it.
    const ids = selection.ids.size > 0 ? [...selection.ids] : [object.id];
    deleteObjects(doc, ids);
    selection.clear();
  }, [canEdit, doc, selection, object.id]);

  const handleTextEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      if (next === 'selected') selection.endEdit();
      else selection.clear();
    },
    [selection],
  );

  return (
    <div
      ref={noteElementRef}
      className="sticky-note"
      data-sticky-note={object.id}
      data-testid="sticky-note"
      data-note-id={object.id}
      data-color={sticky.color}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: `${object.x}px`,
        top: `${object.y}px`,
        width: `${object.width}px`,
        height: `${object.height}px`,
        background: STICKY_COLORS[sticky.color],
        // The stacking order is CSS's, not the DOM's, so a drag is never
        // interrupted by an element moving (sticky.move).
        zIndex: String(sticky.z),
        // Page-chrome children undo the world scale with this, keeping a constant
        // on-screen size.
        ['--inverse-zoom' as string]: String(1 / (zoom || 1)),
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="sticky-note-content">
        {editing && ytext ? (
          <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={handleTextEnd} />
        ) : (
          <div
            className="sticky-text"
            data-testid="sticky-text"
            style={{ fontSize: `${fit.fontPx}px` }}
          >
            {sticky.text}
          </div>
        )}
        {/* The measurement element carries the same text with the same wrapping but
            is never seen; it is what the fit search measures. */}
        <div ref={measureRef} className="sticky-measure" aria-hidden="true">
          {sticky.text}
        </div>
        {fit.overflow ? <div className="sticky-fade" data-testid="sticky-fade" aria-hidden="true" /> : null}
      </div>

      {/* The note toolbar belongs to a lone selected note, and is hidden while it
          is being dragged or edited (PRD "Structure"); a multi-select shows the
          selection bar instead. */}
      {showsOwnToolbar(props) && !dragging ? (
        <div className="note-toolbar-anchor">
          <NoteToolbar
            color={sticky.color}
            onColor={handleColor}
            onDelete={handleDelete}
            canEdit={canEdit}
          />
        </div>
      ) : null}

      {/* selectionSize is in scope for a future per-selection toolbar; read here so
          the type stays honest without a second render path. */}
      {void selectionSize}
    </div>
  );
}

export default StickyNote;
