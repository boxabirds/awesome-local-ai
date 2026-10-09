import type { ReactElement } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

const PAD = 12;
const TEXT_BOX = STICKY_SIZE_WORLD - PAD * 2;

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * False while the board failed to load (load_failed): selection still works
   * but every mutation (drag, edit, colour, delete) is a no-op.
   */
  editable: boolean;
  onSelect(id: string | null): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/**
 * A sticky note in world coordinates (the parent world layer is scaled).
 * Handles select (press without moving), drag to move (beyond the threshold,
 * divided by zoom so the grabbed point stays under the pointer), double-click
 * to edit, and the floating note toolbar. All mutations go through the
 * shared board model.
 */
export function StickyNote(props: StickyNoteProps): ReactElement {
  const { note, doc, zoom, selected, editing, editable } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    noteX: number;
    noteY: number;
    mode: 'pressed' | 'dragging';
  } | null>(null);

  // Text auto-fit: measure the current text at candidate sizes.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    el.textContent = note.text;
    const fit = fitFontSize(el, TEXT_BOX);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [note.text]);

  const ytext = getStickyText(doc, note.id);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (editing) return; // the textarea owns the pointer while editing
    rootRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      noteX: note.x,
      noteY: note.y,
      mode: 'pressed',
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === 'pressed' && editable && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      d.mode = 'dragging';
      bringToFront(doc, note.id);
    }
    if (d.mode === 'dragging') {
      // A false return means the note was deleted meanwhile: end the drag.
      if (!moveObject(doc, note.id, d.noteX + dx / zoom, d.noteY + dy / zoom)) {
        dragRef.current = null;
      }
    }
  };

  const endDrag = (e: React.PointerEvent, becameSelection: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    try {
      rootRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be released
    }
    if (becameSelection && d) props.onSelect(note.id);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) return; // load_failed: text editing is a no-op
    props.onStartEdit(note.id);
  };

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Sticky note"
      data-note-id={note.id}
      {...(selected ? { 'data-selected': 'true' } : {})}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        background: STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow,
        borderRadius: 3,
        boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
        outline: selected ? '2px solid #1a73e8' : 'none',
        outlineOffset: 1,
        cursor: editing ? 'text' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, true)}
      onPointerCancel={(e) => endDrag(e, true)}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="sticky-text"
        style={{
          position: 'absolute',
          inset: PAD,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          fontSize: fontPx,
          lineHeight: 1.25,
          color: '#23272e',
          pointerEvents: 'none',
        }}
      >
        {note.text}
      </div>
      {overflow && (
        <div
          className="text-fade"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 24,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.18))',
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: -99999,
          top: 0,
          width: TEXT_BOX,
          visibility: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.25,
          fontFamily: 'inherit',
          fontSize: STICKY_FONT_MAX_PX,
          pointerEvents: 'none',
        }}
      />
      {selected && !editing && (
        <NoteToolbar
          color={note.color}
          onColor={(c: StickyColor) => {
            if (editable) setStickyColor(doc, note.id, c);
          }}
          onDelete={() => {
            if (!editable) return; // load_failed: deletion is a no-op
            deleteObject(doc, note.id);
            props.onSelect(null);
          }}
        />
      )}
      {editing && ytext && (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} padding={PAD} onEnd={props.onEndEdit} />
      )}
    </div>
  );
}
