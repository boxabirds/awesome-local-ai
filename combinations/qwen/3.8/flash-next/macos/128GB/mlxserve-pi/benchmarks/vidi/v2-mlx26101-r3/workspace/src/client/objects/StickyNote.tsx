import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_PADDING_WORLD,
  type StickyColor,
} from '../../shared/config';
import { deleteObject, getStickyText, setStickyColor } from '../../shared/board-model';
import { NoteToolbar } from './NoteToolbar';
import type { ObjectProps } from './registry';
import { fitFontSize } from './StickyText';
import { StickyTextEditor, type EditEnd } from './StickyTextEditor';

/** Story 2's name for the props; a note is drawn from what any board object is drawn from. */
export type StickyNoteProps = ObjectProps;

/** Height available for text, in world units (jsdom lays nothing out at all). */
function textBox(el: HTMLElement, height: number): number {
  const box = el.clientHeight;
  return box > 0 ? box : height - STICKY_PADDING_WORLD * 2;
}

/**
 * A sticky note: a coloured square with text centred in it, that can be dragged with one
 * pointer, double-clicked (or Enter) to type in, recoloured and deleted.
 *
 * Two rules keep it consistent with everything else in the app:
 *
 * - The note is *positioned and sized* by `left`/`top`/`width`/`height` in world units, so the
 *   world layer's `scale(zoom)` gives it screen size for free.
 * - Every change is applied to the shared document through the board model, and the note then
 *   re-renders from the document snapshot it is given. Nothing here holds a copy of the note's
 *   position, size or text in state, so there is no second truth to get out of step (which is
 *   what would make a note jump when a peer's change arrives, story 3).
 *
 * What story 7 took out of this file is the dragging. A note no longer knows how to move
 * itself: it reports the press to the board (`onObjectPointerDown`) and the board decides - the
 * same gesture that moves one note moves the nine that are selected, and a note that dragged
 * itself would be a type that cannot be moved with the others. What stays is the note's own
 * business: its text, its colour, its font, and the toolbar that belongs to it.
 */
export function StickyNote({
  object,
  doc,
  zoom,
  selected,
  editing,
  /** A note is being carried by a gesture; component tests that draw one on its own are not. */
  transforming = false,
  // A note is editable unless the app says the board it belongs to is not.
  canEdit = true,
  onObjectPointerDown,
  onObjectLostPointerCapture,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  /** The note's text, which lives in the document as a `Y.Text` (story 3 needs that). */
  const ytext = useMemo(() => getStickyText(doc, object.id), [doc, object.id]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // A note is not the board: the press must never start a pan or a marquee.
    event.stopPropagation();
    if (editing) {
      // While typing, a press inside the note edits text (the textarea gets it first).
      return;
    }
    const el = ref.current;
    if (el !== null && document.activeElement !== el) {
      el.focus({ preventScroll: true });
    }
    // Selection, and whatever movement follows, is the board's: it is the same gesture for one
    // note and for a whole selection, which is the only reason one drag can move nine notes.
    onObjectPointerDown(event, object.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // Stop it reaching the board, which would otherwise add a second note here.
    event.stopPropagation();
    if (!editing) {
      onStartEdit(object.id);
    }
  };

  const onColor = (color: StickyColor): void => {
    if (!canEdit) {
      return;
    }
    setStickyColor(doc, object.id, color);
  };

  // Auto-fit: the largest font in the allowed range at which the text still fits, so a
  // one-word note is big and a full note is small. Only needed while the text is shown
  // (the editor fits itself as you type). It is the *note* that is resized, so a bigger note
  // means a bigger font: the note's size is one of the inputs.
  const fitText = useCallback((): void => {
    const el = textRef.current;
    if (el === null) {
      return;
    }
    const fit = fitFontSize(el, textBox(el, object.height));
    setFontPx((current) => (current === fit.fontPx ? current : fit.fontPx));
    setOverflow((current) => (current === fit.overflow ? current : fit.overflow));
  }, [object.height]);

  useLayoutEffect(() => {
    if (editing) {
      return;
    }
    fitText();
  }, [editing, object.text, object.height, fitText]);

  // After Escape the note keeps the selection; give the keyboard somewhere to go, so
  // Enter edits it again and Delete removes it.
  const wasEditingRef = useRef(false);
  useEffect(() => {
    if (wasEditingRef.current && !editing) {
      ref.current?.focus({ preventScroll: true });
    }
    wasEditingRef.current = editing;
  }, [editing]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Only keys pressed on the note itself. Delete, Enter and the arrows are handled once at
    // window level; here Space is stopped from scrolling the board. Keys that belong to the text
    // editor inside this note - a space typed into the text - are left completely alone, or the
    // note would be impossible to type in.
    if (editing || event.target !== event.currentTarget) {
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
    }
  };

  const color = STICKY_COLORS[object.color];
  const showToolbar = selected && !editing && !transforming;

  return (
    <div
      ref={ref}
      className="sticky-note"
      data-sticky-note=""
      data-testid="sticky-note"
      data-note-id={object.id}
      data-object-id={object.id}
      data-object-type={object.type}
      data-color={object.color}
      data-x={object.x}
      data-y={object.y}
      data-width={object.width}
      data-height={object.height}
      data-z={object.z}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={transforming ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: `${object.x}px`,
        top: `${object.y}px`,
        width: `${object.width}px`,
        height: `${object.height}px`,
        background: color,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onLostPointerCapture={(event) => {
        event.stopPropagation();
        onObjectLostPointerCapture(event, object.id);
      }}
    >
      {/* Everything that belongs to the note's face is inside a clipping box, so text
          that is too long is cut off by the note instead of spilling over the board - and
          so the toolbar below is the one thing allowed to stick out. */}
      <div className="sticky-note__clip">
        {editing && ytext !== undefined ? (
          <StickyTextEditor
            ytext={ytext}
            fontPx={fontPx}
            onEnd={(next: EditEnd) => {
              onEndEdit(next);
            }}
          />
        ) : (
          <div
            ref={textRef}
            className="sticky-note__text"
            data-testid="sticky-note-text"
            style={{ fontSize: `${fontPx}px` }}
          >
            {object.text}
          </div>
        )}
        {!editing && overflow ? (
          <div
            className="sticky-note__fade"
            data-testid="sticky-note-fade"
            data-overflow="true"
            aria-hidden="true"
          />
        ) : null}
      </div>
      {showToolbar ? (
        <div
          className="sticky-note__toolbar-anchor"
          data-board-ui=""
          /* The toolbar hangs above the note and is scaled by 1/zoom, so it keeps its
              screen size however far out the board is zoomed. */
          style={{ '--inv-zoom': zoom > 0 ? String(1 / zoom) : '1' } as CSSProperties}
          onPointerDown={(event) => {
            // The toolbar is pressed, not dragged: choosing a colour is not a way to start
            // carrying the note around with it.
            event.stopPropagation();
          }}
        >
          <NoteToolbar
            color={object.color}
            onColor={onColor}
            onDelete={() => {
              if (!canEdit) {
                return;
              }
              // The board forgets the note entirely; the selection goes with it.
              onEndEdit('unselected');
              deleteObject(doc, object.id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}