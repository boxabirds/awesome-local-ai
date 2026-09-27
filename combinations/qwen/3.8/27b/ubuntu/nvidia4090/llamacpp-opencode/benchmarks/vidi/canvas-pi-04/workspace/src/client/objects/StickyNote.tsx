// Story 2: one sticky note (anchor: sticky.interaction): render, select,
// drag to move, double-click to edit.
//
// Story 3: position, colour and text come from the shared Y.Doc snapshot, so
// remote changes re-render this note through the parent.
//
// Story 7: this note is now a registered object type. It renders its size from
// the snapshot (width/height, falling back to STICKY_SIZE_WORLD) and delegates
// pointer-down to the shared transform gesture (sel.all_types). Selection,
// outlines, the toolbar and the resize handles live outside the note (the
// SelectionOverlay / SelectionBar), so every future object type gets them for
// free.

import { useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import { getStickyText, type StickySnapshot } from '../../shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

/** Inner padding of the note in world units (kept for the font-fit box). */
const TEXT_PADDING_WORLD = 12;

export function StickyNote(props: ObjectProps): JSX.Element {
  const { obj, selected, editing } = props;
  const note = obj as StickySnapshot;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLElement | null>(null);
  const [overflow, setOverflow] = useState(false);

  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;

  // Fit the text into the note (binary search, world-px font sizes) on mount,
  // on text/size change and when the editor swaps in. Empty text needs no
  // fitting; otherwise the measurement is deferred to the next frame (see the
  // story 2 rationale: fitting synchronously while a large board mounts would
  // thrash layout and blow the load budget).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el === null) return;
    if (note.text === '') {
      setOverflow(false);
      return;
    }
    let frame = requestAnimationFrame(() => {
      const fit = fitFontSize(el, width - TEXT_PADDING_WORLD * 2);
      setOverflow(fit.overflow);
    });
    return () => cancelAnimationFrame(frame);
  }, [note.text, width, editing]);

  // --- pointer: hand to the shared transform gesture (sel.transform) --------
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (editing) return; // the textarea owns pointer events while editing
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); // the board must not pan/marquee/create on a note press
    props.onPointerDown(e);
  };

  // --- keyboard and edit ----------------------------------------------------
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation(); // the board must not create a note on a note dblclick
    if (!editing && props.canEdit) props.onStartEdit(obj.id);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' && !editing && props.canEdit) {
      e.preventDefault();
      props.onStartEdit(obj.id);
    }
  };

  const color: StickyColor = note.color in STICKY_COLORS ? note.color : DEFAULT_STICKY_COLOR;
  const ytext = getStickyText(props.doc, obj.id);

  return (
    <div
      ref={rootRef}
      className={`sticky-note${overflow ? ' has-fade' : ''}`}
      role="group"
      aria-label="Sticky note"
      data-note-id={obj.id}
      data-color={note.color}
      data-selected={selected ? '' : undefined}
      tabIndex={0}
      style={{
        left: obj.x,
        top: obj.y,
        width,
        height,
        background: STICKY_COLORS[color],
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      {editing && ytext !== undefined ? (
        <StickyTextEditor
          ytext={ytext}
          textRef={textRef}
          rootRef={rootRef}
          onEnd={() => props.onEndEdit(obj.id)}
        />
      ) : (
        <div ref={(el) => void (textRef.current = el)} className="sticky-note__text">
          {note.text}
        </div>
      )}
      <div className="sticky-note__fade" aria-hidden="true" />
    </div>
  );
}
