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

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom; notes scale with the board, the note toolbar does not. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** When false (board failed to load), drag/edit/colour/delete are no-ops. */
  editable?: boolean;
  /** Story 7: delegate pointer events to the transform gesture. */
  onObjectPointerDown?(e: React.PointerEvent<HTMLDivElement>, id: string): void;
  /** Story 7: true while a transform gesture is active on this object. */
  dragging?: boolean;
}

/** @deprecated Use the callback directly; kept for prop compat */
export type EndEditNext = 'selected' | 'unselected';

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
  onSelect,
  onStartEdit,
  onEndEdit,
  editable = true,
  onObjectPointerDown,
  dragging = false,
}: StickyNoteProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const noteWidth = note.width ?? STICKY_SIZE_WORLD;
  const noteHeight = note.height ?? STICKY_SIZE_WORLD;

  // Text auto-fit: the largest size that fits, recomputed when the text changes.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const box = el.clientHeight > 0 ? el.clientHeight : Number.POSITIVE_INFINITY;
    const result = fitFontSize(el, box);
    setFontPx((prev) => (prev === result.fontPx ? prev : result.fontPx));
    setOverflow((prev) => (prev === result.overflow ? prev : result.overflow));
  }, [note.text, editing, noteWidth]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation();
      if (editing) return;
      if (!editable) return;
      // Delegate to the transform gesture
      if (onObjectPointerDown) {
        onObjectPointerDown(e, note.id);
      } else {
        // Fallback: just select (for backward compatibility with old harness)
        onSelect(note.id);
      }
    },
    [note.id, editing, editable, onSelect, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
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
      setStickyColor(doc, note.id, color);
    },
    [doc, note.id, editable],
  );

  const handleDelete = useCallback(() => {
    if (!editable) return;
    deleteObject(doc, note.id);
    onEndEdit('unselected');
  }, [doc, note.id, onEndEdit, editable]);

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
        width: noteWidth,
        height: noteHeight,
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
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} />
      )}
      {selected && !editing && !dragging && (
        <div
          data-testid="note-toolbar-anchor"
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
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
