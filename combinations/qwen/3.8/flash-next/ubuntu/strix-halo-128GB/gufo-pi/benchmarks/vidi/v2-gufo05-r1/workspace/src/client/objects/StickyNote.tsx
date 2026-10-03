/**
 * One sticky note on the board.
 *
 * It renders a note from the document snapshot:
 *
 *   Unselected ──pointerdown──▶ Pressed ──pointerup──▶ Selected
 *   Selected ──dblclick / Enter──▶ Editing ──Escape──▶ Selected
 *
 * Selection and editing come in as props, so `App` holds the single "what is
 * selected" answer for the whole board — and it holds the press now too. Story 7
 * moved the drag out of the note and into `useTransformGesture`, because dragging a
 * selected note moves the whole selection: the note hands its press to the board and
 * stops propagation, so grabbing a note never pans the board, and the board decides
 * whether that press selects, moves, or resizes.
 *
 * Positions and sizes are world units; the world layer scales them. A note's size is
 * its own (`obj.width`, `obj.height`) rather than the fixed `STICKY_SIZE_WORLD` of
 * story 2, which is what lets a note be resized and stay that way, while a note
 * saved before this story still reads back at the size it has always had.
 */
import { useLayoutEffect, useRef, useState } from 'react';

import { getStickyText, type StickySnapshot } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import type { ObjectProps } from './registry';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

/**
 * `ObjectProps.obj` is the widest snapshot the board works with; this component is
 * registered under `sticky`, so what reaches it was read as a sticky note. Checking
 * the type keeps a mis-registered object from drawing half a note.
 */
function asSticky(obj: ObjectProps['obj']): StickySnapshot | null {
  return obj.type === 'sticky' ? (obj as StickySnapshot) : null;
}

export function StickyNote(props: ObjectProps) {
  const {
    doc,
    selected,
    editing,
    canEdit,
    onObjectPointerDown,
    onFocusSelect,
    onStartEdit,
    onEndEdit,
  } = props;
  const note = asSticky(props.obj);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [fontPx, setFontPx] = useState<number | null>(null);
  const [overflow, setOverflow] = useState(false);

  // Text auto-fit: measured on the displayed text, never on zoom (the world layer
  // scales the note uniformly). It is re-measured when the note is resized, because
  // more paper means bigger text.
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || editing || !note) return;
    const fitted = fitFontSize(element, element.clientHeight);
    setFontPx(fitted.fontPx);
    setOverflow(fitted.overflow);
  }, [editing, note?.text, note?.width, note?.height]);

  if (!note) return null;
  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      data-sticky-note
      data-testid="sticky-note"
      data-note-id={note.id}
      // Every object carries these two, whatever its type: the selection state, for
      // assistive technology and for the tests that read the board as the user sees
      // it (`sel.*`), alongside the story 2 attributes, which stay untouched.
      data-object-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-color={note.color}
      data-note-x={note.x}
      data-note-y={note.y}
      data-note-z={note.z}
      data-note-width={note.width}
      data-note-height={note.height}
      data-text-length={note.text.length}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      className={[
        'sticky-note',
        selected ? 'sticky-note--selected' : '',
        overflow ? 'sticky-note--overflow' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height,
        backgroundColor: STICKY_COLORS[note.color],
        zIndex: note.z,
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Never let this reach the viewport: pressing a note must not pan the board
        // or clear the selection it belongs to.
        event.stopPropagation();
        if (editing) return; // clicks inside the editor place the caret
        onObjectPointerDown(event, note.id);
      }}
      onContextMenu={(event) => {
        // Long-press on a touch device selects the note instead of opening the
        // browser's own menu.
        event.preventDefault();
        if (!editing) onFocusSelect(note.id);
      }}
      onFocus={() => {
        if (!editing && !selected) onFocusSelect(note.id);
      }}
      onDoubleClick={(event) => {
        // A double-click on a note edits it; it must never create another one.
        event.stopPropagation();
        if (editing) return;
        // A board that cannot write cannot open an editor (`TC-25`): there would be
        // a field to type in that nothing would ever store.
        if (!canEdit) return;
        onStartEdit(note.id);
      }}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fontPx ?? STICKY_FONT_MAX_PX} onEnd={onEndEdit} />
      ) : (
        <div
          ref={textRef}
          className="sticky-note__text"
          data-testid="sticky-note-text"
          style={fontPx ? { fontSize: `${fontPx}px` } : undefined}
        >
          {note.text}
        </div>
      )}
      {overflow && !editing ? (
        <div className="sticky-note__fade" data-testid="sticky-note-fade" aria-hidden="true" />
      ) : null}
    </div>
  );
}
