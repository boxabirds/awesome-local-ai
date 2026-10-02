import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import {
  bringToFront,
  deleteObject,
  getObjectsMap,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD } from '../../shared/config';
import type { StickyColor } from '../../shared/config';
import { fitFontSize, NOTE_TEXT_INSET } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';
import type { UndoController } from '../board/undo';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom; notes scale with the board, the note toolbar does not. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  dragging?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Generic transform gesture pointer handler (story 7). */
  onObjectPointerDown?(e: React.PointerEvent<HTMLDivElement>, id: string): void;
  /** When false (board failed to load), drag/edit/colour/delete are no-ops. */
  editable?: boolean;
  undoController?: UndoController;
}

/**
 * One sticky note, drawn in the world layer at its (x, y). Selecting, dragging,
 * editing and recolouring all happen here; every document change goes through
 * board-model.
 */
export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  dragging = false,
  onSelect,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  editable = true,
  undoController,
}: StickyNoteProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  const width = note.width ?? STICKY_SIZE_WORLD;
  const height = note.height ?? STICKY_SIZE_WORLD;

  // Text auto-fit: the largest size that fits, recomputed when the text changes.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    // Without a layout engine (jsdom) clientHeight is 0, and the size stays at
    // the maximum — all a layout-free test can assert.
    const box = el.clientHeight > 0 ? el.clientHeight : Number.POSITIVE_INFINITY;
    const result = fitFontSize(el, box);
    setFontPx((prev) => (prev === result.fontPx ? prev : result.fontPx));
    setOverflow((prev) => (prev === result.overflow ? prev : result.overflow));
  }, [note.text, editing, width]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      // The board must never pan because a press started on a note.
      e.stopPropagation();
      // While editing, a press inside the note belongs to the text caret.
      if (editing) return;
      // A read-only board starts no drag.
      if (!editable) return;

      // Delegate to the generic transform gesture
      if (onObjectPointerDown) {
        onObjectPointerDown(e, note.id);
      }
    },
    [editing, editable, note.id, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Editing this note, never creating a new one behind it.
      e.stopPropagation();
      if (!editable) return;
      onStartEdit(note.id);
    },
    [note.id, onStartEdit, editable],
  );

  // Focus returns to the note when editing ends, so Delete still works.
  useEffect(() => {
    if (selected && !editing) rootRef.current?.focus({ preventScroll: true });
  }, [selected, editing]);

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (!editable) return;
      undoController?.boundary();
      setStickyColor(doc, note.id, color);
      undoController?.boundary();
    },
    [doc, note.id, editable, undoController],
  );

  const handleDelete = useCallback(() => {
    if (!editable) return;
    undoController?.boundary();
    deleteObject(doc, note.id);
    undoController?.boundary();
    onEndEdit('unselected');
  }, [doc, note.id, onEndEdit, editable, undoController]);

  const background = STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow;
  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={rootRef}
      data-note-id={note.id}
      data-testid="sticky-note"
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        backgroundColor: background,
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        outline: selected ? '2px solid #1976D2' : 'none',
        boxSizing: 'border-box',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <div
        ref={textRef}
        data-testid="sticky-note-text"
        className={
          overflow ? 'sticky-note__text sticky-note__text--overflow' : 'sticky-note__text'
        }
        style={{
          position: 'absolute',
          inset: NOTE_TEXT_INSET,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          textAlign: 'center',
          color: '#1f1f1f',
          fontFamily: 'inherit',
          fontWeight: 500,
          lineHeight: 1.25,
          fontSize: fontPx,
          opacity: editing ? 0 : 1,
          pointerEvents: 'none',
        }}
      >
        {note.text}
      </div>
      {overflow && !editing && (
        <div
          className="sticky-note__fade"
          data-testid="sticky-note-fade"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: NOTE_TEXT_INSET,
            right: NOTE_TEXT_INSET,
            bottom: NOTE_TEXT_INSET,
            height: Math.max(12, fontPx * 1.25),
            pointerEvents: 'none',
            background: `linear-gradient(to bottom, rgba(255,255,255,0) 0%, ${background} 85%)`,
          }}
        />
      )}
      {editing && ytext && (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} undoController={undoController} />
      )}
      {selected && !editing && !dragging && (
        <div
          data-testid="note-toolbar-anchor"
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            // Counteracts the world scale so the toolbar keeps a screen-space size.
            transform: `scale(${1 / (zoom || 1)})`,
            transformOrigin: 'bottom left',
            paddingBottom: 8,
          }}
        >
          <NoteToolbar color={note.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}
