/**
 * One sticky note: drawn, selected, moved and edited — but no longer the thing that moves itself.
 *
 * Until story 7 a note owned its own drag: it watched the pointer, wrote its own position and came
 * to the front on its own. That is exactly the arrangement that cannot move six notes at once, so the
 * drag now lives in the board's transform gesture and the note hands it the press. What is left here
 * is what only a note can do: draw itself at the size the document says, keep its text fitted to that
 * size, offer its colours and its bin, and open its own text for typing.
 *
 * The size is the new part, and it is the part with history. Notes written before this story carry no
 * `width` and no `height` — every note was the same size, and that size was a constant in the code —
 * so a note that has none is drawn `STICKY_SIZE_WORLD` on a side, which is the size it really is. The
 * first resize writes both fields, and from then on that note is whatever size it was dragged to.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';

import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import {
  deleteObjects,
  getStickyText,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

/** The registry key of a sticky note, and the value of its `type` field. */
export const STICKY_OBJECT_TYPE = 'sticky';

/** The inside of a note of this width, in world units: the box the text has to fit into. */
export const stickyContentSize = (width: number): number =>
  Math.max(0, (Number.isFinite(width) ? width : STICKY_SIZE_WORLD) - 2 * STICKY_PADDING_WORLD);

/** Interaction state of one note; the board owns the first four of them. */
export type NoteInteraction = 'unselected' | 'pressed' | 'selected' | 'dragging' | 'editing';

/**
 * The note's own toolbar (colours, bin) is shown for the note that is the whole selection. Two notes
 * selected is not two notes each with their own tools: it is one selection, and the board puts up one
 * bar for it (`SelectionBar`).
 */
export function StickyNote(props: ObjectProps<StickySnapshot>): React.JSX.Element {
  // `zoom` is in the props every object type is handed, and a sticky note has no use for it:
  // the whole note is scaled by the board's own transform, text included.
  const { obj, doc, selected, soleSelected, pressed, dragging, editing, editable, undo } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);

  // The size the document has, or the size every note is born with. Read, never guessed: an object
  // whose width somebody else wrote is that width on this board and on every other one.
  const width = Number.isFinite(obj.width) ? (obj.width as number) : STICKY_SIZE_WORLD;
  const height = Number.isFinite(obj.height) ? (obj.height as number) : STICKY_SIZE_WORLD;
  const contentSize = stickyContentSize(width);

  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  // Auto-fit: measure on mount and whenever the text or the box it sits in changes. Zoom scales the
  // whole note uniformly, so a font size in world units does not depend on it.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const next = fitFontSize(el, contentSize);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [obj.text, contentSize]);

  // The measure element is a plain mirror of the text box: nothing to clean up when the note goes
  // away, because the editor unmounts with the note, which is what ends a text edit on a note that
  // somebody else deleted mid-edit.

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // A press on a note belongs to the note: the board must not pan under it.
    event.stopPropagation();
    if (editing) return; // a press inside the editor edits text, not the note
    // What happens next — select, toggle, drag the whole selection — is the board's business.
    props.onObjectPointerDown(event, obj.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A double-click on a note edits it; the board must not create a new one.
    event.stopPropagation();
    if (!editable) return; // opening the editor would be an invitation to write
    if (!editing) props.onStartEdit(obj.id);
  };

  const pickColor = (color: StickyColor) => {
    if (!editable) return;
    // Only the colour changes: text, position, size, stacking and selection all stay put.
    //
    // And it changes as a step of its own. A click on a swatch is one thing a person did, even when
    // they did it a quarter of a second after dragging the note somewhere — and without the line
    // before, undo would take the colour back and leave the note where it was moved from.
    undo?.boundary();
    setStickyColor(doc, obj.id, color);
    undo?.boundary();
  };

  const remove = () => {
    if (!editable) return;
    // Out of the same door everything else goes out of, so that the selection on the other side of
    // it is one answer rather than two. One click of the bin is one step: a selection of eight notes
    // goes back under one undo, and the delete that follows a drag is not folded into the drag.
    undo?.boundary();
    const deleted = deleteObjects(doc, [obj.id]) > 0;
    undo?.boundary();
    if (deleted) props.onDeleted(obj.id);
  };

  const interaction: NoteInteraction = editing
    ? 'editing'
    : dragging
      ? 'dragging'
      : pressed
        ? 'pressed'
        : selected
          ? 'selected'
          : 'unselected';

  return (
    <div
      aria-label="Sticky note"
      className="sticky-note"
      data-color={obj.color}
      data-font-px={fit.fontPx}
      data-height={height}
      data-interaction={interaction}
      data-note-id={obj.id}
      data-object-id={obj.id}
      data-overflow={fit.overflow ? 'true' : 'false'}
      data-selected={selected ? 'true' : undefined}
      data-testid="sticky-note"
      data-width={width}
      data-x={obj.x}
      data-y={obj.y}
      data-z={obj.z}
      ref={ref}
      role="group"
      style={{
        left: obj.x,
        top: obj.y,
        width,
        height,
        background: STICKY_COLORS[obj.color],
        // One source of truth for the note's inner padding: the CSS uses this variable for the text
        // box, the editor and the fade.
        '--sticky-pad': `${STICKY_PADDING_WORLD}px`,
      } as React.CSSProperties}
      tabIndex={0}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
    >
      {/* Hidden mirror of the text box, used to measure the largest font that fits. */}
      <div
        aria-hidden="true"
        className="sticky-measure"
        data-testid={`sticky-measure-${obj.id}`}
        ref={measureRef}
        style={{ width: contentSize, height: contentSize }}
      >
        {obj.text}
      </div>
      {editing ? (
        <StickyTextEditor
          fontPx={fit.fontPx}
          key={obj.id}
          onEnd={() => props.onEndEdit(obj.id)}
          undo={undo}
          ytext={sharedText(doc, obj.id)}
        />
      ) : (
        <div
          className="sticky-text"
          data-testid="sticky-text"
          style={{ fontSize: `${fit.fontPx}px` }}
        >
          {obj.text}
        </div>
      )}
      {fit.overflow ? (
        <div aria-hidden="true" className="sticky-overflow-fade" data-testid="sticky-overflow-fade" />
      ) : null}
      {soleSelected && !dragging && !editing && editable ? (
        <NoteToolbar color={obj.color} onColor={pickColor} onDelete={remove} />
      ) : null}
    </div>
  );
}

/** The note's shared text; a note deleted mid-edit falls back to a throwaway `Y.Text`. */
function sharedText(doc: Y.Doc, id: string): Y.Text {
  return getStickyText(doc, id) ?? new Y.Text();
}
