// A sticky note on the canvas (`sticky.component`, `sticky.text` display half),
// reached through the object registry like every other kind of object.
//
// Story 7 took its pointer logic away. Selecting, moving and resizing are one
// generic gesture for every object type now, so a note hands its press to that
// gesture (`onObjectPointerDown`) and keeps only what is about being a note: its
// colour, its auto-fitted text and the shared-text editor. The per-note toolbar is
// gone from here too — one selection bar above the board does that job now, for one
// note or for fifty (`SelectionBar`).
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { StickySnapshot } from '../../shared/board-model';
import { getStickyText, objectBounds } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import type { ObjectProps } from './registry';
import { StickyTextEditor } from './StickyTextEditor';
import { STICKY_TEXT_PADDING_WORLD, fitFontSize, stickyTextContentBox } from './StickyText';

export interface StickyNoteProps extends Omit<ObjectProps, 'object'> {
  note: StickySnapshot;
}

const SELECTED_OUTLINE = '2px solid #2f6feb';

/**
 * One sticky note: its text auto-fitted to the note's own width, plus the shared
 * editor while editing. A press is handed to the generic transform gesture, which
 * selects and moves it; a double-click opens the editor.
 */
export function StickyNote({
  note,
  doc,
  selected,
  editing,
  editable = true,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): ReactNode {
  const [font, setFont] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);
  const displayRef = useRef<HTMLDivElement | null>(null);

  const bounds = objectBounds(note);

  // Auto-fit the display text whenever it changes (not while editing). The font is
  // in board units, so measure unscaled and let the world layer scale the result;
  // the box is the note's own height, so resizing a note re-fits its text.
  useLayoutEffect(() => {
    if (editing) return;
    const el = displayRef.current;
    if (!el) return;
    const result = fitFontSize(el, stickyTextContentBox(bounds.height));
    setFont((prev) => (prev === result.fontPx ? prev : result.fontPx));
    setOverflow((prev) => (prev === result.overflow ? prev : result.overflow));
  }, [note.text, editing, bounds.height]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!editable || editing || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Selecting, raising and moving are all the gesture's business, not the note's.
    onObjectPointerDown(event.nativeEvent, note.id);
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!editable) return;
    event.stopPropagation();
    if (!editing) onStartEdit(note.id);
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  const noteStyle: CSSProperties = {
    position: 'absolute',
    left: note.x,
    top: note.y,
    width: bounds.width,
    height: bounds.height,
    backgroundColor: STICKY_COLORS[note.color],
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.20)',
    borderRadius: 2,
    boxSizing: 'border-box',
    pointerEvents: 'auto',
    cursor: 'grab',
    outline: selected ? SELECTED_OUTLINE : 'none',
    userSelect: editing ? 'text' : 'none',
    touchAction: 'none',
  };

  const textStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    padding: `${STICKY_TEXT_PADDING_WORLD}px`,
    boxSizing: 'border-box',
    color: '#1f2328',
    fontFamily: 'var(--vidi6-font)',
    lineHeight: 1.25,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
    textAlign: 'center',
    overflow: 'hidden',
    fontSize: `${font}px`,
  };

  return (
    <div
      data-testid="sticky-note"
      data-id={note.id}
      data-z={note.z}
      data-color={note.color}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      aria-roledescription={editable ? 'Sticky note' : 'Sticky note (read-only board)'}
      tabIndex={0}
      style={noteStyle}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={font}
          height={bounds.height}
          onEnd={onEndEdit}
        />
      ) : (
        <div
          ref={displayRef}
          data-testid="sticky-note-text"
          data-overflow={overflow ? 'true' : 'false'}
          className={
            overflow ? 'sticky-note__text sticky-note__text--overflow' : 'sticky-note__text'
          }
          style={textStyle}
        >
          {note.text}
        </div>
      )}
      {overflow && !editing ? <div data-testid="sticky-note-fade" style={fadeStyle} /> : null}
    </div>
  );
}

const fadeStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(to bottom, rgba(0,0,0,0) 60%, rgba(0,0,0,0.12))',
  pointerEvents: 'none',
};
