import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import {
  deleteObject,
  getStickyText,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import { NoteToolbar } from './NoteToolbar';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

export interface StickyNoteProps {
  /** Plain data for this note, from the board snapshot. */
  note: StickySnapshot;
  /** The shared document the mutations are applied to. */
  doc: Y.Doc;
  /** Camera zoom, screen pixels per world unit. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Pointer down delegates to the transform gesture. */
  onPointerDown?(e: ReactPointerEvent<HTMLDivElement>, id: string): void;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** If true, the note is part of a multi-selection (hide own toolbar). */
  multiSelected?: boolean;
  /** If true, this note is currently being dragged. */
  dragging?: boolean;
}

/**
 * One sticky note on the board.
 *
 * It is a rectangle of colour in the world layer, so it pans and zooms with
 * everything else. A press delegates to the generic transform gesture
 * (useTransformGesture) which handles group move. A double-click edits its text.
 *
 * A press never reaches the viewport: dragging a note must not pan the board,
 * and releasing on a note must not clear the selection.
 */
export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onPointerDown,
  onSelect,
  onStartEdit,
  onEndEdit,
  multiSelected,
  dragging,
}: StickyNoteProps): JSX.Element {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  const onEndEditRef = useRef(onEndEdit);
  onEndEditRef.current = onEndEdit;

  // Compute width/height (fall back to STICKY_SIZE_WORLD for implicit-size notes)
  const width = note.width ?? STICKY_SIZE_WORLD;
  const height = note.height ?? STICKY_SIZE_WORLD;

  /** Fit the display text to the note (measurement, so after layout). */
  useLayoutEffect(() => {
    if (editing) return;
    const element = textRef.current;
    if (!element) return;
    const textBox = Math.min(width, height) - STICKY_PADDING_WORLD * 2;
    const fit = fitFontSize(element, textBox);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [note.text, editing, width, height]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // The board must neither pan nor lose the selection because of a press on a note.
    event.stopPropagation();
    if (editing) return; // clicks inside an editing note move the caret
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    // If Shift is held, toggle the selection
    if (event.shiftKey) {
      onSelect(note.id);
      return;
    }

    // Delegate to the transform gesture
    if (onPointerDown) {
      onPointerDown(event, note.id);
    }
  };

  const handleDoubleClick = (
    event: ReactMouseEvent<HTMLDivElement> | ReactPointerEvent<HTMLDivElement>,
  ): void => {
    // A double-click on a note edits it; it must not create another note.
    event.stopPropagation();
    if (editing) return;
    onStartEdit(note.id);
  };

  // A press outside the note ends editing.
  useEffect(() => {
    if (!editing) return undefined;
    const handleDocumentPointerDown = (event: PointerEvent): void => {
      const element = elementRef.current;
      if (
        element !== null &&
        event.target instanceof Node &&
        element.contains(event.target)
      ) {
        return;
      }
      onEndEditRef.current('unselected');
    };
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  }, [editing]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={elementRef}
      className="sticky-note"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-color={note.color}
      data-note-color={note.color}
      data-note-x={note.x}
      data-note-y={note.y}
      data-note-width={width}
      data-note-height={height}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: note.x,
        top: note.y,
        width,
        height,
        background: STICKY_COLORS[note.color],
        zIndex: note.z,
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext !== undefined ? (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          ref={textRef}
          className="sticky-note__text"
          data-testid="sticky-text"
          data-overflow={overflow ? 'true' : 'false'}
          style={{ fontSize: `${fontPx}px` }}
        >
          {note.text}
        </div>
      )}
      {overflow && !editing ? (
        <div
          className="sticky-note__fade"
          data-testid="sticky-fade"
          aria-hidden="true"
          style={{
            background: `linear-gradient(to bottom, transparent 0%, ${STICKY_COLORS[note.color]} 85%)`,
          }}
        />
      ) : null}

      {/* Note toolbar: shown when exactly one sticky is selected, not editing, not dragging */}
      {selected && !editing && !multiSelected && !dragging ? (
        <div
          className="sticky-note__toolbar-anchor"
          data-testid="note-toolbar-anchor"
          style={{ transform: `scale(${1 / (zoom || 1)})` }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color: StickyColor) => {
              setStickyColor(doc, note.id, color);
            }}
            onDelete={() => {
              deleteObject(doc, note.id);
              onEndEdit('unselected');
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
