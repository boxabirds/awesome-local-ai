/**
 * One sticky note in the world layer (anchors: sticky.interaction, sticky.select,
 * sticky.no_pan, sticky.text_fit, sel.transform).
 *
 * Since story 7 the note has no drag code of its own: its pointerdown goes to the generic
 * transform gesture (select, Shift-click, group move) and its toolbar is the selection
 * bar's. The note renders its `width`/`height`; the content is laid out at the story 2
 * size (STICKY_SIZE_WORLD) and scaled, so text fits identically at every note size.
 */
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import type * as Y from 'yjs';
import { getStickyText, type StickySnapshot } from '../../shared/board-model';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_LINE_HEIGHT,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

const HALF = 2;
/** Height available to text inside the (unscaled) note body, in world units. */
const TEXT_BOX = STICKY_SIZE_WORLD - HALF * STICKY_PADDING_WORLD;

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Part of a selection being moved or resized. */
  transforming?: boolean;
  /** Pointerdown handler of the transform gesture (select / move). */
  onPointerDown?(e: PointerEvent<HTMLElement>, id: string): void;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** False while the board cannot be edited (story 4 load failure): no move, edit, colour or delete. */
  editable?: boolean;
}

function StickyNoteImpl(props: StickyNoteProps): React.JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit } = props;
  const editable = props.editable ?? true;
  const transforming = props.transforming ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pointerActive = useRef(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false, offsetTop: 0 });

  const ytext = useMemo(() => getStickyText(doc, note.id), [doc, note.id]);

  // Text fit: on mount and whenever the text changes (size and zoom scale uniformly).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el === null) return;
    const result = fitFontSize(el, TEXT_BOX);
    // An empty note still has one (caret) line when editing.
    const contentHeight = Math.max(contentRef.current?.offsetHeight ?? 0, result.fontPx * STICKY_LINE_HEIGHT);
    const offsetTop = result.overflow ? 0 : Math.max(0, (TEXT_BOX - contentHeight) / HALF);
    setFit((f) =>
      f.fontPx === result.fontPx && f.overflow === result.overflow && f.offsetTop === offsetTop
        ? f
        : { ...result, offsetTop },
    );
  }, [note.text]);

  // Leaving edit mode with the note still selected keeps keyboard focus on the note.
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing && selected) rootRef.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing, selected]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // The board must never pan (or clear the selection) because of a press on a note.
    e.stopPropagation();
    if (editing) return;
    pointerActive.current = true;
    props.onPointerDown?.(e, note.id);
  };
  const onPointerEnd = () => {
    pointerActive.current = false;
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editing && editable) onStartEdit(note.id);
  };

  // Keyboard focus (Tab) selects the note; pointer focus is handled by the gesture.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || pointerActive.current || selected) return;
    onSelect(note.id);
  };

  const style = {
    left: `${note.x}px`,
    top: `${note.y}px`,
    width: `${note.width}px`,
    height: `${note.height}px`,
    // Stacking follows the document's z; equal z falls back to DOM order, which is by id.
    zIndex: note.z,
    backgroundColor: STICKY_COLORS[note.color],
    '--note-bg': STICKY_COLORS[note.color],
    '--zoom': String(zoom),
    '--sticky-padding': `${STICKY_PADDING_WORLD}px`,
    '--note-scale': String(note.height / STICKY_SIZE_WORLD),
    lineHeight: String(STICKY_LINE_HEIGHT),
  } as CSSProperties;
  const bodyStyle: CSSProperties = {
    width: `${STICKY_SIZE_WORLD}px`,
    height: `${STICKY_SIZE_WORLD}px`,
    transform: `scale(${note.width / STICKY_SIZE_WORLD}, ${note.height / STICKY_SIZE_WORLD})`,
  };

  const state = editing ? 'editing' : transforming ? 'dragging' : selected ? 'selected' : 'unselected';

  return (
    <div
      ref={rootRef}
      className={`sticky-note${fit.overflow ? ' sticky-fade' : ''}`}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-id={note.id}
      data-color={note.color}
      data-selected={selected ? 'true' : 'false'}
      data-state={state}
      style={style}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={onDoubleClick}
      onFocus={onFocus}
    >
      <div className="sticky-body" style={bodyStyle}>
        <div
          ref={textRef}
          className="sticky-text"
          data-testid="sticky-text"
          style={{ fontSize: `${fit.fontPx}px`, visibility: editing ? 'hidden' : undefined }}
        >
          <div ref={contentRef} className="sticky-text-content">
            {note.text}
          </div>
        </div>
        {editing && editable && ytext !== undefined && (
          <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} offsetTop={fit.offsetTop} onEnd={onEndEdit} />
        )}
      </div>
    </div>
  );
}

export const StickyNote = memo(StickyNoteImpl);
