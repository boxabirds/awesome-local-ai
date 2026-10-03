// One sticky note (story 2), now a *passive* board object (story 7).
//
// It renders at its own world bounds (so it can be resized), shows its auto-fit
// text, opens a shared-text editor on double-click, and — when it is the only
// selected object — shows its own colour/bin toolbar. Everything to do with
// selecting, moving and resizing is delegated to the generic transform gesture via
// `onObjectPointerDown`: the note no longer owns any drag logic, so story 7's group
// move/resize treats it exactly like every other object type. `data-selected` is
// the outline the selection machinery turns on for this object.

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../shared/config';
import { getStickyText, objectBounds, type StickySnapshot } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';
import type { ObjectProps } from './registry';

export type StickyNoteProps = ObjectProps;

/**
 * A sticky note inside the world layer (so it scales with zoom). A click/press is
 * handed to the transform gesture (`onObjectPointerDown`), which selects it and may
 * begin a group move; a double-click edits. The colour/bin toolbar shows only when
 * this note is the *sole* selection (`sole`) — a multi-object selection uses the
 * shared selection bar instead.
 */
export function StickyNote({
  obj,
  doc,
  zoom,
  selected,
  sole,
  editing,
  canEdit,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
  onColor,
  onDelete,
}: StickyNoteProps) {
  const note = obj as StickySnapshot;
  const textRef = useRef<HTMLDivElement | null>(null);
  const [displayFit, setDisplayFit] = useState({ fontPx: 24, overflow: false });

  // Measure the display text and pick the largest font that fits the note.
  const measureDisplay = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    const box = el.clientHeight || el.offsetHeight || STICKY_SIZE_WORLD;
    const result = fitFontSize(el, box);
    setDisplayFit((prev) =>
      prev.fontPx === result.fontPx && prev.overflow === result.overflow
        ? prev
        : result,
    );
  }, []);

  useLayoutEffect(() => {
    if (!editing) measureDisplay();
  }, [note.text, editing, measureDisplay]);

  const handleDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!canEdit) return; // editing a note is a board mutation
    if (!editing) onStartEdit(note.id);
  };

  const bounds = objectBounds(obj);
  const color = STICKY_COLORS[note.color];
  const showToolbar = sole && !editing;
  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-testid={`sticky-note-${note.id}`}
      tabIndex={0}
      className="sticky-note"
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        zIndex: note.z,
        width: bounds.width,
        height: bounds.height,
        backgroundColor: color,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => onObjectPointerDown(e, note.id)}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={displayFit.fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          ref={textRef}
          data-testid="sticky-note-text"
          className="sticky-text"
          data-overflow={displayFit.overflow ? 'true' : 'false'}
          style={{ fontSize: `${displayFit.fontPx}px` }}
        >
          {note.text}
        </div>
      )}
      {!editing && displayFit.overflow ? (
        <div
          className="sticky-fade"
          data-testid="sticky-overflow-fade"
          aria-hidden="true"
        />
      ) : null}
      {showToolbar ? (
        // Counter-scaled by 1/zoom so the toolbar keeps a constant on-screen size
        // while its note scales with the board.
        <div
          className="note-toolbar-scale"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `scale(${1 / zoom})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(c) => onColor(note.id, c)}
            onDelete={() => onDelete(note.id)}
          />
        </div>
      ) : null}
    </div>
  );
}
