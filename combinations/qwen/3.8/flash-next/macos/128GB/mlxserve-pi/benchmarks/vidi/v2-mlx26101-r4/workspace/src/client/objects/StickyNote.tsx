/**
 * One sticky note on the board: how it looks, how it is selected, how it is typed into.
 *
 * What story 7 took away from this file is the drag. It used to own the whole of it — threshold,
 * pointer capture, per-frame writes, raising the note above the others — and owning it was fine while a
 * note was the only thing on the board and a drag could only ever move one note. It stopped being fine
 * the moment a drag had to move six things at once, because then the question "what moves when this is
 * dragged?" has an answer that involves everything else on the board, and a note cannot know that. The
 * answer now lives in `useTransformGesture`; this file reports the press and shows the result.
 *
 * What is left is the note's own business:
 *
 *   - its size, which is the document's `width`/`height` when it has them and STICKY_SIZE_WORLD when it
 *     does not — a note made before this story has neither field, and must not jump or grow on that
 *     account;
 *   - its text, and the fitting of it (measured in the layout phase, so the size is right before the
 *     browser paints and the note never flashes at the wrong size);
 *   - the toolbar that belongs to exactly one note: colours and a bin, which is why it stands aside as
 *     soon as the person is holding more than one object, when the question is no longer about this one.
 *
 * The interaction states are the same ones as before, but read rather than driven:
 *
 *   idle → pressed → dragging → idle, and idle → selected → editing → selected.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import {
  deleteObject,
  getStickyText,
  isStickySnapshot,
  objectBounds,
  setStickyColor,
  STICKY_OBJECT_TYPE,
} from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import { NoteToolbar } from './NoteToolbar';
import type { ObjectProps } from './objectProps';
import { STICKY_TEXT_BOX, StickyTextEditor } from './StickyTextEditor';
import { fitFontSize } from './StickyText';
import type { Fit } from './StickyText';

/** Gap between the top of a note and its toolbar, in screen pixels. */
const TOOLBAR_GAP_PX = 8;

/** The mouse button that picks a note up. */
const PRIMARY_MOUSE_BUTTON = 0;

export type StickyNoteProps = ObjectProps;

/**
 * The note's own fields, which is the part of an `ObjectSnapshot` that only a sticky note has.
 *
 * The board hands every component the general shape, because the board does not know what types exist; a
 * type knows what *it* is, and says so here. An object of another type wearing this type's name is a bug
 * in whoever rendered it, and is answered with the defaults a note would have had before it stored any
 * of this — a yellow note with nothing written on it, rather than a crash in the middle of a board.
 */
function noteFields(object: ObjectProps['object']): { color: StickySnapshot['color']; text: string } {
  if (!isStickySnapshot(object)) return { color: DEFAULT_STICKY_COLOR, text: '' };
  return { color: object.color, text: object.text };
}

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { object, doc, zoom, selected, selectedCount, editing, readOnly, interaction } = props;
  const { color, text } = noteFields(object);
  const elementRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  // A note is a square on the board even when it does not know its own size yet, so everything that
  // draws — the note, the outlines, the toolbar's perch — measures the same rect.
  const bounds = objectBounds(object);

  /**
   * The press, handed straight to the board.
   *
   * What happens next is not this note's decision: whether the press selects, adds to a selection, or
   * picks up a whole group is settled by the selection and the gesture, which between them know what
   * else is selected. All that is decided here is which presses are not the board's business at all: a
   * right-click, and a press that lands on text that is open for typing.
   */
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (readOnly) {
      // The press stops here: the board neither pans nor selects, because a note that cannot be moved
      // should not look like it can be.
      event.stopPropagation();
      return;
    }
    // Only the left button picks a note up; the others are left alone.
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    // The board neither pans nor clears its selection because of a note.
    event.stopPropagation();
    // While this note's text is open, the press belongs to the text — and the press that closes it is
    // caught by the listener below, which runs before this one.
    if (editing) return;
    props.onPointerDown(event, object.id);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // A note is edited, never duplicated: the board must not see this click.
    event.stopPropagation();
    if (editing || readOnly) return;
    props.onStartEdit(object.id);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Reached by keyboard: Tab moves to a note, Enter edits it. The board's own shortcuts (Delete,
    // Escape, arrows) are handled where the selection lives, and reach here by bubbling.
    if (event.key !== 'Enter') return;
    // While typing, Enter adds a line: a keydown that started in the textarea arrives here by bubbling,
    // and must not be swallowed.
    if (editing || readOnly) return;
    event.preventDefault();
    props.onStartEdit(object.id);
  };

  // A pointerdown anywhere outside this note ends editing and lets go of it. Capture phase, so it runs
  // before the board reacts to the same press — which is what lets a press on another note close this
  // one's text and select the other note in the same gesture.
  const { onEndEdit } = props;
  useLayoutEffect(() => {
    if (!editing) return;
    const onDocumentPointerDown = (event: PointerEvent): void => {
      const element = elementRef.current;
      if (element && event.target instanceof Node && element.contains(event.target)) return;
      onEndEdit();
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  }, [editing, onEndEdit]);

  // The displayed text is measured in the layout phase, so the font size lands before the browser paints
  // and the note never flashes at the wrong size. The box it is measured against is this note's own — a
  // note resized small holds less text than one at full size, and says so. While editing, the editor
  // measures the textarea as the user types instead.
  useLayoutEffect(() => {
    if (editing) return;
    const element = textRef.current;
    if (!element) return;
    const measured = fitFontSize(element, STICKY_TEXT_BOX);
    setFit((previous) =>
      previous.fontPx === measured.fontPx && previous.overflow === measured.overflow ? previous : measured,
    );
  }, [text, editing, bounds.width, bounds.height]);

  const ytext = editing ? getStickyText(doc, object.id) : undefined;
  // The toolbar is the control for one note. With two or more objects selected the selection bar is the
  // control that is honest about what it acts on, and the two must never be on screen together.
  const showsToolbar = selected && selectedCount === 1 && !editing && interaction !== 'dragging';

  return (
    <div
      ref={elementRef}
      className={fit.overflow ? 'sticky-note sticky-note--overflow' : 'sticky-note'}
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-note-id={object.id}
      data-note-type={STICKY_OBJECT_TYPE}
      data-note-color={color}
      data-selected={selected ? 'true' : 'false'}
      data-interaction={interaction}
      data-overflow={fit.overflow ? 'true' : 'false'}
      tabIndex={0}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        backgroundColor: STICKY_COLORS[color],
        fontSize: `${fit.fontPx}px`,
        // Stacking lives here, not in the order of the children: raising a note that is held has to be a
        // style change, not a move in the document.
        zIndex: object.z,
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {editing && ytext ? <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} onFit={setFit} /> : null}
      {editing ? null : (
        <div className="sticky-note__text" data-testid="sticky-text" ref={textRef}>
          {text}
        </div>
      )}
      {fit.overflow ? <div className="sticky-note__fade" data-testid="sticky-fade" aria-hidden="true" /> : null}
      {showsToolbar ? (
        <div
          className="sticky-note__toolbar-slot"
          data-testid="note-toolbar-slot"
          style={{
            bottom: bounds.height,
            // The note itself is scaled by the zoom, so scaling the toolbar by the reciprocal keeps it
            // the same size on screen at every zoom.
            transform: `scale(${1 / (zoom > 0 ? zoom : 1)}) translateY(${-TOOLBAR_GAP_PX}px)`,
          }}
        >
          <NoteToolbar
            color={color}
            disabled={readOnly}
            onColor={(next) => {
              // Colour only: text, position, stacking and the selection stay put.
              setStickyColor(doc, object.id, next);
            }}
            onDelete={() => {
              // One note, the one this toolbar belongs to. The board drops the selection with it.
              deleteObject(doc, object.id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
