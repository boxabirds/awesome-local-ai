import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import {
  deleteObject,
  getStickyText,
  isStickySnapshot,
  STICKY_TYPE,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';
import type { EndEditNext } from '../board/useSelection';
import type { ObjectProps } from '../objects/registry';

/** Padding between the note edge and its text, in world units. */
export const STICKY_PADDING_WORLD = 12;
/** The box the text has to fit in for a note of the default size. */
export const STICKY_TEXT_BOX_WORLD = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;
/** Selection outline colour (PRD: a blue outline). */
export const SELECTION_OUTLINE = '#2563eb';
/** Keeps the selected note (and its toolbar) above every other note. */
export const SELECTED_STACK_ABOVE = 1_000_000;

/**
 * The box the note's text has to fit in, in world units. Sticky notes keep their
 * proportions (sel.aspect), so this is the note's width as much as its height; a resized
 * note fits its text to the smaller side instead of clipping it.
 */
export function stickyTextBoxWorld(note: StickySnapshot): number {
  const side = Math.min(note.width, note.height);
  return Math.max(STICKY_PADDING_WORLD, side - STICKY_PADDING_WORLD * 2);
}

/**
 * One sticky note: its text, its colour, and the outline this client draws when it is
 * selected.
 *
 * Since story 7 it does *not* implement selection, dragging, resizing or deleting itself:
 * `onObjectPointerDown` hands the press to the generic transform gesture
 * (`useTransformGesture`), which is what makes a sticky note and a shape (story 10) move
 * the same way when several of them are selected (sel.all_types). What stays here is what
 * only a sticky note knows: its text, its font auto-fit and its colour toolbar.
 */
export function StickyNote(props: ObjectProps): JSX.Element | null {
  const { object } = props;
  // The registry hands every sticky-ish object to this component; one that turned out to
  // be another type is not ours to draw.
  if (!isStickySnapshot(object)) return null;
  return <StickyNoteBody {...props} note={object} />;
}

interface StickyNoteBodyProps extends ObjectProps {
  note: StickySnapshot;
}

function StickyNoteBody({
  note,
  doc,
  zoom,
  selected,
  selectedCount,
  editing,
  dragging,
  readOnly = false,
  onSelect,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: StickyNoteBodyProps): JSX.Element {
  const noteRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const onEndEditRef = useRef(onEndEdit);
  onEndEditRef.current = onEndEdit;

  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const background = STICKY_COLORS[note.color];
  const ytext = useMemo(() => getStickyText(doc, note.id), [doc, note.id]);

  /**
   * Auto-fit the text. Measuring the always-rendered text layer (hidden behind the
   * textarea while editing) means display and editing text share one font size, and
   * `scrollHeight` is measured in world units, unaffected by the zoom transform. A note
   * that was resized since story 2 re-fits to its new box (sel.resize).
   */
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const next = fitFontSize(el, stickyTextBoxWorld(note));
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [note.text, note.width, note.height, editing]);

  /*
   * A click focuses the note it pressed, because notes are focusable so that Tab reaches
   * them. That focus must not select anything: the press has already decided the selection,
   * and for Shift+click it decided something the focus handler could only undo (it would
   * replace the group with the one note just added). So a press notes itself down, and the
   * focus that follows one ignores itself.
   */
  const pressedRef = useRef(false);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    // Touch devices are out of scope for this story.
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    // The board must never start a pan from a note (sticky.no_pan).
    event.stopPropagation();
    pressedRef.current = true;
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'TEXTAREA') return; // let the caret move inside the editor
    if (editing) onEndEditRef.current('selected');
    // Selecting, raising and moving are the gesture's business, including on a board that
    // could not be loaded, where it selects and then refuses to write (story 4).
    onObjectPointerDown(event, note.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // The viewport would otherwise create a second note here (TC-35).
    event.stopPropagation();
    if (editing || readOnly) return;
    onStartEdit(note.id);
  };

  const onFocus = (event: ReactFocusEvent<HTMLDivElement>): void => {
    // Tab reaches the note; Enter then starts editing it.
    if (event.target !== event.currentTarget) return;
    if (pressedRef.current) {
      // The focus a pointer press caused; the press has already selected.
      pressedRef.current = false;
      return;
    }
    onSelect(note.id);
  };

  const onBlur = (): void => {
    // Leaving the note ends the press that focused it, so the next Tab selects again.
    pressedRef.current = false;
  };

  // A pointerdown anywhere outside the note ends editing (the board decides the selection).
  useEffect(() => {
    if (!editing) return;
    const onDocumentPointerDown = (event: PointerEvent): void => {
      const element = noteRef.current;
      const target = event.target as Node | null;
      if (!element || !target) return;
      if (element.contains(target)) return;
      onEndEditRef.current('unselected');
    };
    document.addEventListener('pointerdown', onDocumentPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
    };
  }, [editing]);

  const handleEndEdit = useCallback((next: EndEditNext): void => {
    onEndEditRef.current(next);
  }, []);

  const handleColor = (color: StickyColor): void => {
    // Only the colour changes: text, position, stacking and the selection are untouched.
    setStickyColor(doc, note.id, color);
  };

  const handleDelete = (): void => {
    deleteObject(doc, note.id);
  };

  /*
   * The note toolbar belongs to a *single* selected note. With two or more objects
   * selected the board shows the selection bar instead (sel.bar), so this note keeps no
   * toolbar of its own.
   */
  const showToolbar = selected && selectedCount === 1 && !editing && !dragging && !readOnly;

  const noteStyle = {
    left: `${note.x}px`,
    top: `${note.y}px`,
    width: `${note.width}px`,
    height: `${note.height}px`,
    backgroundColor: background,
    zIndex: selected ? SELECTED_STACK_ABOVE : note.z,
    outlineWidth: selected ? '2px' : '0',
    outlineColor: SELECTION_OUTLINE,
    // The text box inset both the text layer and the textarea use.
    '--vidi6-sticky-pad': `${STICKY_PADDING_WORLD}px`,
  } as CSSProperties;

  return (
    <div
      ref={noteRef}
      className="vidi6-sticky"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-note-type={STICKY_TYPE}
      data-note-x={note.x}
      data-note-y={note.y}
      data-note-z={note.z}
      data-note-width={note.width}
      data-note-height={note.height}
      data-note-color={note.color}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={noteStyle}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div
        ref={contentRef}
        className={editing ? 'vidi6-sticky-content vidi6-sticky-measuring' : 'vidi6-sticky-content'}
        data-testid="sticky-text"
      >
        {note.text}
      </div>
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={handleEndEdit} />
      ) : null}
      {fit.overflow ? (
        <div
          className="vidi6-sticky-fade"
          data-testid="sticky-fade"
          style={{ background: `linear-gradient(to bottom, rgba(0, 0, 0, 0), ${background})` }}
        />
      ) : null}
      {showToolbar ? (
        <div
          className="vidi6-sticky-toolbar-anchor"
          style={{ transform: `scale(${1 / (zoom || 1)})` }}
        >
          <NoteToolbar color={note.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      ) : null}
    </div>
  );
}
