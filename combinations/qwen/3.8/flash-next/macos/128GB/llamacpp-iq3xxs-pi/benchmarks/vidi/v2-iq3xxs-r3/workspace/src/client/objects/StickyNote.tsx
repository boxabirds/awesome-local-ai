import { useLayoutEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

import { STICKY_COLORS, STICKY_FONT_MAX_PX } from '../../shared/config';
import { getStickyText, isStickySnapshot, objectBounds } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

/** Text inset inside a note (board units); mirrors the CSS padding. */
export const STICKY_TEXT_PADDING = 12;

/**
 * One sticky note, drawn from the object snapshot and registered as an object
 * type (`sel.registry`): it owns how a note *looks* — colour, text that fits
 * itself to the box, the fade over text that will not fit — and nothing else.
 *
 * Story 7 took its interaction away. Selecting, moving, resizing and deleting are
 * the board's business, because they are the same for every object type and must
 * work on six notes at once; a note now only says where it is and hands over its
 * pointer, and the generic transform gesture (`sel.transform`) decides whether
 * that press becomes a drag. That is also why this component no longer knows
 * about toolbars or transactions: it has no pointer logic of its own left to get
 * wrong, and no way to disagree with the gesture about where the note is.
 */
export function StickyNote({
  object,
  doc,
  selected,
  editing,
  editable,
  dragging,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: ObjectProps): JSX.Element | null {
  const note = isStickySnapshot(object) ? object : undefined;
  // A note whose record is not a note's — from an older board, or a type that
  // borrowed this component — cannot be drawn as one, so it is not drawn at all.
  if (!note) return null;
  const bounds = objectBounds(note);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // The board must never pan, and never clear this note's selection because of
    // a press on it (sticky.no_pan, sticky.select): the gesture owns the press.
    event.stopPropagation();
    // While the text is being typed, the textarea owns the pointer: a press that
    // started a drag would also end the edit it was typing into.
    if (editing) return;
    onObjectPointerDown(event, note.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // Never create a note on top of this one (TC-35): a double-click on a note
    // starts editing instead (sticky.edit_start).
    event.stopPropagation();
    if (editable && !editing) onStartEdit(note.id);
  };

  // Text fit: measure the (possibly hidden) text layer whenever the text or the
  // width changes — zoom scales uniformly, so re-running per zoom is pointless.
  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const box = bounds.width - 2 * STICKY_TEXT_PADDING;
    const next = fitFontSize(element, box);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [note.text, bounds.width]);

  const ytext = getStickyText(doc, note.id);

  return (
    <div
      className="sticky-note"
      role="group"
      aria-label="Sticky note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      data-color={note.color}
      data-x={note.x}
      data-y={note.y}
      data-z={note.z}
      data-width={bounds.width}
      data-height={bounds.height}
      tabIndex={0}
      style={{
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        background: STICKY_COLORS[note.color],
        zIndex: note.z,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <div className="sticky-text-viewport">
        {/* Kept mounted while editing: it is what `fitFontSize` measures, and
            it shows the text of a note that is not being edited. */}
        <div
          ref={textRef}
          className="sticky-text"
          data-testid="sticky-text"
          aria-hidden={editing ? 'true' : undefined}
          style={{
            fontSize: `${fit.fontPx}px`,
            visibility: editing ? 'hidden' : 'visible',
          }}
        >
          {note.text}
        </div>
      </div>
      {editing && ytext ? <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} /> : null}
      {fit.overflow ? <div className="text-fade" data-testid="text-fade" aria-hidden="true" /> : null}
    </div>
  );
}
