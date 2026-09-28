import {
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
} from 'react';
import { STICKY_SIZE_WORLD, STICKY_COLORS, STICKY_FONT_MAX_PX } from 'src/shared/config';
import type { StickySnapshot } from 'src/shared/board-model';
import { getStickyText } from 'src/shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

/** Padding (world units) shared by display text and the editor textarea. */
export const STICKY_NOTE_PADDING = 12;

const SELECTION_OUTLINE = '#1A73E8';

/**
 * One sticky note: renders at world (x, y) with its (possibly resized)
 * width/height in the world layer.
 *
 * Story 7: all press/drag handling is delegated to the generic transform
 * gesture (`onPointerDown`) — single-object dragging, group moves, selection
 * and shift-click all go through the same machinery as every other object
 * type (sel.all_types). What remains here is purely note-specific: text
 * display/fit and the text editor.
 *
 * Interaction state per note (local, never stored in the doc):
 * Unselected → Pressed (pointerdown) → Selected (up) or Dragging (≥ threshold)
 * → Selected (up/cancel); Selected → Editing (dblclick / Enter) → Selected
 * (Escape) / Unselected (click outside).
 */
export function StickyNote(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, editable = true, onStartEdit, onEndEdit } = props;
  const note = obj as StickySnapshot;

  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;

  const ytext = getStickyText(doc, note.id);
  // The generic ObjectSnapshot (from allObjects) does not carry `text`; the
  // live Y.Text is the source of truth, so read the display string from it.
  const text = ytext ? ytext.toString() : '';

  // Font fit: run on text/size change and on mount only (zoom scales world
  // units uniformly). The display div is always mounted so it can measure
  // even while the editor is showing.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    setFit(fitFontSize(el, width));
  }, [text, width]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || editing) return;
    // The board must not pan while a note is pressed (sticky.no_pan).
    e.stopPropagation();
    // Selection (click / shift-click) and move (drag) are the generic
    // gesture's job, including the load-failed lock (it only selects).
    props.onPointerDown(e, note.id);
  };

  const handleDblClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Dblclick on a note edits it; the board must not create a new note.
    e.stopPropagation();
    if (!editing && editable) onStartEdit(note.id);
  };

  const color = STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected || undefined}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        backgroundColor: color,
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
        borderRadius: 2,
        outline: selected ? `2px solid ${SELECTION_OUTLINE}` : 'none',
        outlineOffset: -1,
        cursor: editing ? 'text' : 'move',
        zIndex: note.z,
        touchAction: 'none',
        // Firefox: without this a drag on the note text starts a native text
        // selection that swallows the pointermove/pointerup stream, so the
        // generic move/resize gesture never sees the drag (e2e, TC-33/34).
        userSelect: editing ? 'auto' : 'none',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDblClick}
      onFocus={() => {
        if (!selected) props.onSelect(note.id);
      }}
    >
      {/* Display text — always mounted so it can measure the fit, even while editing. */}
      <div
        ref={textRef}
        data-testid="sticky-note-text"
        style={{
          position: 'absolute',
          inset: 0,
          padding: STICKY_NOTE_PADDING,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          fontSize: fit.fontPx,
          lineHeight: 1.2,
          color: 'rgba(0,0,0,0.8)',
          visibility: editing ? 'hidden' : 'visible',
          pointerEvents: 'none',
        }}
      >
        {text}
      </div>
      {fit.overflow && !editing && (
        <div
          data-testid="sticky-note-fade"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: STICKY_NOTE_PADDING * 2,
            background: `linear-gradient(to top, ${color} 0%, transparent 100%)`,
            pointerEvents: 'none',
          }}
        />
      )}
      {editing && ytext && (
        <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
      )}
    </div>
  );
}
