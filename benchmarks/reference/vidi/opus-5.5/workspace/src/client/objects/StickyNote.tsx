import {
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { getStickyText, isSticky, objectBounds } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import type { ObjectProps } from './registry';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

/** Selection outline thickness in screen px (kept constant at every zoom). */
const OUTLINE_SCREEN_PX = 2;

type Fit = { fontPx: number; overflow: boolean };

/**
 * One sticky note in the world layer. Presses go to the board's generic select / move gesture
 * (story 7: the note has no drag code of its own), double-click edits. Pointer presses never
 * reach the board, so dragging a note never pans. Size is the stored width/height, or
 * STICKY_SIZE_WORLD for notes saved before story 7.
 */
function StickyNoteImpl(props: ObjectProps) {
  const { object, doc, zoom, stackIndex, selected, editing, dragging, onPointerDown: onGesturePointerDown, onSelect, onStartEdit, onEndEdit, readOnly } =
    props;
  const bodyRef = useRef<HTMLDivElement>(null);
  const pointerFocusRef = useRef(false);
  const [fit, setFit] = useState<Fit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  const bounds = objectBounds(object);

  // Largest font at which the text fits the note's width; font is in world units, so zoom
  // never changes the fit.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const next = fitFontSize(el, bounds.width);
    setFit((f) => (f.fontPx === next.fontPx && f.overflow === next.overflow ? f : next));
  }, [object.text, bounds.width]);

  if (!isSticky(object)) return null;
  const note = object;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The board must neither pan nor clear the selection.
    e.stopPropagation();
    if (editing) return;
    pointerFocusRef.current = true;
    onGesturePointerDown(e, note.id);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editing && !readOnly) onStartEdit(note.id);
  };

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    // While editing, presses on the note's padding keep focus in the textarea.
    if (editing && !(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
  };

  const onFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    // Keyboard (Tab) focus selects the note so Enter / Delete act on it.
    if (e.target !== e.currentTarget) return;
    const fromPointer = pointerFocusRef.current;
    pointerFocusRef.current = false;
    if (!fromPointer && !selected) onSelect(note.id);
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const style: CSSProperties = {
    transform: `translate(${note.x}px, ${note.y}px)`,
    width: bounds.width,
    height: bounds.height,
    backgroundColor: STICKY_COLORS[note.color],
    zIndex: stackIndex,
    outlineWidth: selected ? `${OUTLINE_SCREEN_PX / zoom}px` : undefined,
  };

  const className = [
    'sticky-note',
    selected && 'sticky-note--selected',
    dragging && 'sticky-note--dragging',
    editing && 'sticky-note--editing',
    fit.overflow && 'sticky-note--overflow',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-color={note.color}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      onFocus={onFocus}
    >
      <div ref={bodyRef} className="sticky-note__body" style={{ fontSize: `${fit.fontPx}px` }}>
        <div className="sticky-note__text" data-testid="sticky-text">
          {note.text}
        </div>
        {ytext && <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />}
      </div>
      {fit.overflow && (
        <div
          className="sticky-note__fade"
          aria-hidden="true"
          style={{ backgroundImage: `linear-gradient(to bottom, transparent, ${STICKY_COLORS[note.color]})` }}
        />
      )}
    </div>
  );
}

export const StickyNote = memo(StickyNoteImpl);
