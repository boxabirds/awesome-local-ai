import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  getStickyText,
  objectBounds,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_OVERFLOW_BAND_PX,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { EndEditTarget } from '../board/useSelection';

/** Inner padding of a note, in board units (a visual detail, not a product setting). */
const NOTE_PADDING = 14;

export interface StickyNoteProps {
  note: StickySnapshot;
  /** Board document: only read, for the shared `Y.Text` while editing. */
  doc: Y.Doc;
  /** Part of this client's selection. */
  selected: boolean;
  /** The local user is typing in it. */
  editing: boolean;
  /** A transform gesture is moving it (story 7): no per-note toolbar. */
  dragging: boolean;
  /** Begin editing (`null`) or end editing, keeping or dropping the selection. */
  onEditChange(next: EndEditTarget | null): void;
  /**
   * Press on the note's body. The note no longer drags itself: the generic
   * transform gesture decides whether this becomes a click, a group move or
   * nothing, which is what lets every object type behave the same way.
   */
  onObjectPointerDown(
    event: ReactPointerEvent<HTMLDivElement> | PointerEvent,
    snapshot: StickySnapshot,
  ): void;
}

/**
 * One sticky note on the board.
 *
 * Renders at world `(x, y)` inside the scaled world layer, at its stored
 * `width`/`height` (or STICKY_SIZE_WORLD for a note that has never been
 * resized), filled with its colour, text centred and auto-fitted to the box.
 *
 * Selection, editing and moving live outside this component: the note reports a
 * press to the transform gesture and a double-click to the selection, and shows
 * what the owner tells it to show. The colour and delete toolbar used to hang
 * off the note; with several objects selectable it belongs to the selection (see
 * `SelectionBar`), so a group gets one control instead of one per note.
 */
export function StickyNote(props: StickyNoteProps) {
  const { note, doc, selected, editing, dragging, onEditChange, onObjectPointerDown } = props;
  const noteRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [font, setFont] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  // Size comes from the object: an old note (no width/height) keeps the default.
  const bounds = useMemo(() => objectBounds(note), [note]);
  const textBox = Math.max(0, bounds.height - NOTE_PADDING * 2);
  const measureWidth = Math.max(0, bounds.width - NOTE_PADDING * 2);

  // --- Font auto-fit (measure on mount and whenever the text or size changes)
  // Zoom scales the whole world layer uniformly, so it is not a dependency.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const next = fitFontSize(el, textBox);
    setFont((prev) =>
      prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next,
    );
  }, [note.text, textBox]);

  // --- Click outside the note ends editing ---------------------------------
  useEffect(() => {
    if (!editing) return;
    const onDocPointerDown = (event: PointerEvent) => {
      const el = noteRef.current;
      if (!el) return;
      if (event.target instanceof Node && !el.contains(event.target)) {
        onEditChange('unselected');
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
  }, [editing, onEditChange]);

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Editing this note instead of letting the viewport create a new one.
    e.stopPropagation();
    e.preventDefault();
    onEditChange(null);
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={noteRef}
      className="sticky-note"
      data-sticky-note=""
      data-object-body=""
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-overflow={font.overflow ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: `${bounds.x}px`,
        top: `${bounds.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        background: STICKY_COLORS[note.color],
        // Stacking comes from the model's z, not from DOM order, so raising a note
        // mid-drag never moves its element (that would drop the pointer capture).
        zIndex: note.z,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => onObjectPointerDown(e, note)}
      onDoubleClick={onDoubleClick}
    >
      {/* Hidden mirror used to measure the text for font auto-fit. */}
      <div
        ref={measureRef}
        className="sticky-text-style sticky-measure"
        aria-hidden="true"
        style={{ width: `${measureWidth}px`, left: `${NOTE_PADDING}px` }}
      >
        {note.text}
      </div>

      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={font.fontPx}
          onEnd={(next) => onEditChange(next)}
        />
      ) : (
        <div
          className="sticky-text-style sticky-text"
          data-sticky-text=""
          style={{
            fontSize: `${font.fontPx}px`,
            padding: `${NOTE_PADDING}px`,
          }}
        >
          {note.text}
        </div>
      )}

      {font.overflow ? (
        <div
          className="sticky-fade"
          data-sticky-fade=""
          style={{
            height: `${STICKY_OVERFLOW_BAND_PX}px`,
            // Same colour as the note, from fully transparent to opaque, so the
            // text fades into the note instead of into a white veil.
            background: `linear-gradient(to bottom, ${STICKY_COLORS[note.color]}00, ${STICKY_COLORS[note.color]})`,
          }}
        />
      ) : null}
    </div>
  );
}
