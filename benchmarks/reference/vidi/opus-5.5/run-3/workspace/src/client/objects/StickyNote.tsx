import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { getStickyText, isSticky } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_LINE_HEIGHT, STICKY_PADDING_WORLD } from '../../shared/config';
import type { ObjectProps } from './registry';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

function StickyNoteImpl(props: ObjectProps) {
  const { object, doc, zoom, selected, editing, gesture } = props;
  const editable = props.editable;
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // A pointer is down on this note: its focus event must not change the selection (the gesture does that).
  const pointerDownRef = useRef(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false, contentHeight: 0 });
  const note = isSticky(object) ? object : null;
  const text = note?.text ?? '';
  const { width, height } = object;

  // Auto-fit the font on mount and whenever the text or size changes (not on zoom: text is in world units).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const { fontPx, overflow } = fitFontSize(el, height);
    const contentHeight = contentRef.current?.offsetHeight ?? 0;
    setFit((f) =>
      f.fontPx === fontPx && f.overflow === overflow && f.contentHeight === contentHeight
        ? f
        : { fontPx, overflow, contentHeight },
    );
  }, [text, width, height]);

  if (!note) return null;

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const lineHeight = fit.fontPx * STICKY_LINE_HEIGHT;
  const editorPaddingTop = Math.max(STICKY_PADDING_WORLD, (height - Math.max(fit.contentHeight, lineHeight)) / 2);

  const className = ['sticky-note'];
  if (selected) className.push('sticky-note--selected');
  if (editing) className.push('sticky-note--editing');
  if (fit.overflow) className.push('sticky-note--overflow');
  if (gesture === 'dragging') className.push('sticky-note--dragging');

  const style = {
    left: note.x,
    top: note.y,
    width,
    height,
    zIndex: props.stackIndex,
    '--note-color': STICKY_COLORS[note.color],
    '--zoom': zoom,
    '--note-padding': `${STICKY_PADDING_WORLD}px`,
    '--note-line-height': STICKY_LINE_HEIGHT,
  } as CSSProperties;

  const releasePointer = () => {
    pointerDownRef.current = false;
  };
  const trackPointer = () => {
    pointerDownRef.current = true;
    // The release may happen anywhere on the page (the gesture follows the pointer across the window).
    window.addEventListener('pointerup', releasePointer, { once: true, capture: true });
    window.addEventListener('pointercancel', releasePointer, { once: true, capture: true });
  };

  return (
    <div
      ref={rootRef}
      className={className.join(' ')}
      role="group"
      aria-label="Sticky note"
      data-note-id={note.id}
      data-object-id={note.id}
      data-selected={selected}
      data-state={editing ? 'editing' : gesture}
      data-color={note.color}
      data-overflow={fit.overflow}
      tabIndex={0}
      style={style}
      onFocus={(e) => {
        // Keyboard users reach notes with Tab; focusing one selects it (pointer presses go through the gesture).
        if (e.target === e.currentTarget && !selected && !pointerDownRef.current) props.onSelect(note.id);
      }}
      onPointerDown={(e) => {
        // Never let a press on a note reach the board (no pan, no marquee, no deselect).
        e.stopPropagation();
        if (editing) return;
        trackPointer();
        props.onObjectPointerDown(e, note.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing && editable) props.onStartEdit(note.id);
      }}
    >
      <div
        ref={textRef}
        className="sticky-note__text"
        style={{ fontSize: `${fit.fontPx}px` }}
        aria-hidden={editing || undefined}
      >
        <div ref={contentRef} className="sticky-note__content">
          {note.text}
        </div>
      </div>
      {editing && ytext && (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fit.fontPx}
          paddingTop={editorPaddingTop}
          onEnd={(next) => {
            props.onEndEdit(next);
            // Escape leaves the note selected: keep keyboard focus on it (Enter edits again, Delete deletes).
            if (next === 'selected') rootRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}

/** A sticky note in the world layer. Selection, moving and resizing are generic (useTransformGesture). */
export const StickyNote = memo(StickyNoteImpl);
