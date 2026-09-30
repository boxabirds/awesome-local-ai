import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { getStickyText, type StickySnapshot } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_PADDING_WORLD, STICKY_SIZE_WORLD } from '../../shared/config';
import type { ObjectProps } from './registry';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

const TEXT_BOX_WORLD = STICKY_SIZE_WORLD - 2 * STICKY_PADDING_WORLD;
const HALF = 2;

/**
 * One sticky note in the world layer. Selection, moving and resizing are
 * generic (useTransformGesture via `onPointerDown`); double-click edits.
 *
 * Content is laid out at the base size (STICKY_SIZE_WORLD) and scaled by
 * width / STICKY_SIZE_WORLD, so a note resized larger shows larger text and
 * the font fit never depends on the note's size (notes are always square).
 */
export function StickyNote(props: ObjectProps) {
  const note = props.object as StickySnapshot;
  const { doc } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false, padTop: 0 });

  // Auto-fit on text change (the font is in board units, so zoom never changes the fit).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const result = fitFontSize(el, TEXT_BOX_WORLD);
    const contentHeight = contentRef.current?.offsetHeight ?? 0;
    const padTop = STICKY_PADDING_WORLD + Math.max(0, (TEXT_BOX_WORLD - contentHeight) / HALF);
    setFit((f) =>
      f.fontPx === result.fontPx && f.overflow === result.overflow && f.padTop === padTop
        ? f
        : { ...result, padTop },
    );
  }, [note.text]);

  // Leaving edit mode with the note still selected keeps keyboard focus on it.
  const wasEditing = useRef(props.editing);
  useEffect(() => {
    if (wasEditing.current && !props.editing && props.selected) {
      rootRef.current?.focus({ preventScroll: true });
    }
    wasEditing.current = props.editing;
  }, [props.editing, props.selected]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation(); // the board must not pan
    if (props.editing) {
      // Clicks on the note's padding must not steal focus from the textarea.
      if (e.target !== e.currentTarget && !(e.target instanceof HTMLElement && e.target.dataset.stickyScale)) return;
      e.preventDefault();
      return;
    }
    props.onPointerDown(e, note.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // never creates a note underneath
    if (!props.editing && !props.readOnly) props.onStartEdit(note.id);
  };

  const ytext = props.editing ? getStickyText(doc, note.id) : undefined;
  const editing = props.editing && ytext !== undefined;

  return (
    <div
      ref={rootRef}
      className={`sticky-note board-object${props.selected ? ' is-selected' : ''}${props.gesture === 'dragging' ? ' is-dragging' : ''}`}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-note-id={note.id}
      data-object-id={note.id}
      data-selected={props.selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-state={props.gesture}
      data-x={note.x}
      data-y={note.y}
      data-width={note.width}
      data-height={note.height}
      data-z={note.z}
      data-color={note.color}
      style={{
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height,
        backgroundColor: STICKY_COLORS[note.color],
        zIndex: props.zIndex,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="sticky-scale"
        data-sticky-scale="true"
        style={{
          width: STICKY_SIZE_WORLD,
          height: (note.height * STICKY_SIZE_WORLD) / note.width,
          transform: `scale(${note.width / STICKY_SIZE_WORLD})`,
        }}
      >
        <div
          ref={textRef}
          className={`sticky-text${fit.overflow ? ' is-overflowing' : ''}`}
          data-testid="sticky-text"
          style={{
            fontSize: `${fit.fontPx}px`,
            inset: STICKY_PADDING_WORLD,
            visibility: editing ? 'hidden' : undefined,
          }}
          aria-hidden={editing ? true : undefined}
        >
          <div ref={contentRef} className="sticky-text-content">
            {note.text}
          </div>
        </div>
        {editing && ytext && (
          <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} padTop={fit.padTop} onEnd={props.onEndEdit} />
        )}
      </div>
    </div>
  );
}
