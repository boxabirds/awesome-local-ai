import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  deleteObject,
  getStickyText,
  objectBounds,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import { fitFontSize, type FontFit } from './StickyText';
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps, PointerEventLike } from './registry';

/**
 * One sticky note (anchor `sticky.interaction`), drawn and wired through the
 * object type registry.
 *
 * Story 7 took its drag code out: a note no longer decides what a press, a
 * threshold or a group move means. It forwards `pointerdown` to the board's
 * transform gesture (`sel.transform`) and renders whatever the document says,
 * including the `width`/`height` a resize stored - a note that never had one
 * still draws at STICKY_SIZE_WORLD, the size it always had (Key decision 5).
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Unselected
 *     Unselected --> Pressed : pointerdown (delegated to the gesture)
 *     Pressed --> Selected : pointerup within DRAG_THRESHOLD_PX
 *     Pressed --> Dragging : gesture move beyond DRAG_THRESHOLD_PX
 *     Dragging --> Selected : pointerup or pointercancel
 *     Selected --> Editing : dblclick or Enter
 *     Editing --> Selected : Escape
 *     Editing --> Unselected : click outside
 *     Selected --> Unselected : click empty board or Escape
 *     Selected --> [*] : Delete key or bin button
 * ```
 */
export type StickyNoteProps = ObjectProps<StickySnapshot>;

/** The text box inside the note's padding, in board units. */
const textBoxOf = (width: number, height: number): number =>
  Math.min(width, height) - 2 * STICKY_PADDING_WORLD;

export function StickyNote(props: StickyNoteProps) {
  const {
    obj: note,
    doc,
    zoom,
    selected,
    editing,
    dragging,
    editable = true,
    onSelect,
    onStartEdit,
    onEndEdit,
    onObjectPointerDown,
  } = props;

  const [fit, setFit] = useState<FontFit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const noteRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  const bounds = objectBounds(note);
  const width = bounds.width;
  const height = bounds.height;

  /**
   * Auto-fit: measured when the text changes or the note is resized, never on
   * pointer or zoom events. `fitFontSize` sets the font size on the element
   * while it searches.
   */
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) {
      return;
    }
    setFit(fitFontSize(el, textBoxOf(width, height)));
  }, [note.text, width, height]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // The board must neither pan nor create a note (TC-20).
      event.stopPropagation();
      if (editing || event.button !== 0) {
        return;
      }
      // Selection, the drag threshold and the group move all belong to the
      // gesture; a press is allowed even when the board is locked, so the note
      // can still be selected and inspected (`sel.transform` refuses the writes).
      onObjectPointerDown(event as unknown as PointerEventLike, note.id);
    },
    [editing, note.id, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // A double-click on a note edits it instead of creating one (TC-35).
      event.stopPropagation();
      event.preventDefault();
      if (!editable) {
        return;
      }
      onSelect(note.id, false);
      onStartEdit(note.id);
    },
    [editable, note.id, onStartEdit, onSelect],
  );

  const showToolbar = selected && !editing && !dragging && editable;

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (!editable) {
        return;
      }
      setStickyColor(doc, note.id, color);
    },
    [doc, editable, note.id],
  );

  const handleDelete = useCallback(() => {
    if (!editable) {
      return;
    }
    deleteObject(doc, note.id);
  }, [doc, editable, note.id]);

  return (
    <div
      ref={noteRef}
      className="sticky-note"
      data-sticky-note={note.id}
      data-testid={`sticky-note-${note.id}`}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-editable={editable ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      data-width={width}
      data-height={height}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        background: STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow,
        transform: `translate(${note.x}px, ${note.y}px)`,
        zIndex: note.z,
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <div className="sticky-note__clip" style={{ padding: `${STICKY_PADDING_WORLD}px` }}>
        <div
          ref={textRef}
          className="sticky-note__text"
          data-testid={`sticky-text-${note.id}`}
          style={{ fontSize: `${fit.fontPx}px` }}
        >
          {note.text}
        </div>
        {editing && editable ? (
          <StickyTextEditor
            ytext={getStickyText(doc, note.id)!}
            fontPx={fit.fontPx}
            background={STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow}
            onEnd={onEndEdit}
          />
        ) : null}
        <div className="sticky-note__fade" data-testid={`sticky-fade-${note.id}`} aria-hidden="true" />
      </div>
      {showToolbar ? (
        <div
          className="sticky-note__toolbar"
          style={{ transform: `scale(${1 / (zoom || 1)})`, transformOrigin: '0 100%' }}
        >
          <NoteToolbar color={note.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      ) : null}
    </div>
  );
}

/** The size a note that was never resized draws at, shared with the tests. */
export const STICKY_DEFAULT_SIZE = STICKY_SIZE_WORLD;
