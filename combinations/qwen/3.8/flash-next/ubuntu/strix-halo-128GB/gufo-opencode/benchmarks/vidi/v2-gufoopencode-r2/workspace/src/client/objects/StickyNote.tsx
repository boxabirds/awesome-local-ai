// One sticky note in the world layer: renders, selects via the shared
// gesture, and starts editing. Selection, dragging and the toolbar live in
// the board-level machinery (useTransformGesture, SelectionBar); this
// component only paints and delegates pointerdown.

import { useLayoutEffect, useRef, useState } from 'react';
import { getStickyText, type StickySnapshot } from '../../shared/board-model';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import { STICKY_PADDING_WORLD, fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

export type StickyNoteProps = ObjectProps;

export function StickyNote({
  obj,
  doc,
  selected,
  editing,
  editable,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): React.JSX.Element {
  const note = obj as StickySnapshot;
  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  const textBox = width - STICKY_PADDING_WORLD * 2;
  const [overflow, setOverflow] = useState(false);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const textRef = useRef<HTMLDivElement | null>(null);

  // Text auto-fit for display mode (real layout exists only in a browser; in
  // jsdom scrollHeight is 0, so the fit stays at the maximum size).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const result = fitFontSize(el, textBox);
    setOverflow(result.overflow);
    setFontPx(result.fontPx);
  }, [note.text, editing, textBox]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      className="sticky-note"
      tabIndex={0}
      style={
        {
          left: note.x,
          top: note.y,
          width,
          height,
          background: STICKY_COLORS[note.color],
          '--note-bg': STICKY_COLORS[note.color],
          zIndex: note.z,
        } as React.CSSProperties
      }
      onPointerDown={(e) => {
        if (editing) return; // caret placement inside the textarea stays with the editor
        if (!editable) return; // load_failed: no drag (the board pans behind instead)
        // The board must not pan when a press starts on a note (sticky.no_pan).
        e.stopPropagation();
        onObjectPointerDown(e, note.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation(); // never create a second note here (TC-35)
        if (!editing && editable) onStartEdit(note.id);
      }}
    >
      {editing && editable ? (
        ytext ? (
          <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} />
        ) : null
      ) : (
        <div
          ref={textRef}
          className={overflow ? 'sticky-text sticky-overflow' : 'sticky-text'}
          data-testid="sticky-text"
          style={{ fontSize: fontPx }}
        >
          {note.text}
        </div>
      )}
    </div>
  );
}
