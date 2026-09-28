// A sticky note on the board (story 2 sticky.interaction + story 7
// sel.all_types): renders at its world position in the world layer.
//
// Pointer interaction (select, move, resize) is delegated to the GENERIC
// transform gesture (story 7, useTransformGesture) via onPointerDown — the
// note no longer owns drag state. It keeps its own text rendering, font
// auto-fit and editing state.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { getStickyText } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD } from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

/** Padding (world px) between the note edge and its text. */
export const NOTE_PADDING_PX = 12;

export function StickyNote(props: ObjectProps): ReactElement {
  const { obj, doc, selected, editing, locked, dragging } = props;
  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  const textElRef = useRef<HTMLDivElement>(null);

  // Font auto-fit: measure on mount and whenever the text or width changes
  // (the snapshot updates on every text edit / resize). Zoom scales the
  // world uniformly, so no re-measure is needed on zoom.
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });
  useEffect(() => {
    const el = textElRef.current;
    if (!el) return;
    setFit(fitFontSize(el, width - 2 * NOTE_PADDING_PX));
  }, [obj.text, editing, width]);

  const onPointerDownNote = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (editing) return; // the textarea owns the pointer while editing
    props.onPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation(); // editing the note, never creating a new one
    if (locked) return; // load-failed: no text editing
    props.onStartEdit(obj.id);
  };

  const ytext = getStickyText(doc, obj.id);
  const bg = STICKY_COLORS[obj.color ?? 'yellow'];

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-id={obj.id}
      data-selected={selected ? 'true' : undefined}
      data-editing={editing ? 'true' : undefined}
      className={`sticky-note${selected ? ' sticky-note--selected' : ''}${
        selected && dragging ? ' sticky-note--dragging' : ''
      }`}
      tabIndex={0}
      style={{
        left: obj.x,
        top: obj.y,
        width,
        height,
        background: bg,
        ['--sticky-bg' as string]: bg,
      }}
      onPointerDown={onPointerDownNote}
      onDoubleClick={onDoubleClick}
      onFocus={() => {
        if (!selected) props.onSelect(obj.id); // Tab-reachable notes are selectable
      }}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={() => props.onEndEdit()} />
      ) : (
        <div
          ref={textElRef}
          data-testid="sticky-note-text"
          className={`sticky-note-text${fit.overflow ? ' sticky-note-fade' : ''}`}
          style={{ fontSize: fit.fontPx }}
        >
          {obj.text}
        </div>
      )}
    </div>
  );
}
