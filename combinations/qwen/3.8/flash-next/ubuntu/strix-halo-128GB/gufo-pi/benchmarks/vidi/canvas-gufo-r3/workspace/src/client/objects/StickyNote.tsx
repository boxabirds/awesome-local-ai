import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  StickySnapshot,
  moveObject,
  bringToFront,
  getStickyText,
  setStickyColor,
  deleteObject,
} from '@shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DRAG_THRESHOLD_PX, StickyColor } from '@shared/config';
import { fitFontSize, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '@shared/config';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export const NOTE_PADDING = 12;
export const NOTE_TOOLBAR_OFFSET = 44;

type NoteInteraction = 'unselected' | 'pressed' | 'selected' | 'dragging' | 'editing';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [fontPx, setFontPx] = useState<number>(24);
  const [overflow, setOverflow] = useState<boolean>(false);
  const [dragging, setDragging] = useState<boolean>(false);
  const [pressed, setPressed] = useState<boolean>(false);

  const draggingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const dragOriginRef = useRef({ screenX: 0, screenY: 0, worldX: 0, worldY: 0 });
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const state: NoteInteraction = editing ? 'editing' : dragging ? 'dragging' : pressed ? 'pressed' : selected ? 'selected' : 'unselected';

  // --- text auto-fit (zoom scales world units uniformly, so fit is zoom-independent) ---
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const result = fitFontSize(el, STICKY_SIZE_WORLD);
    setFontPx((prev) => (prev === result.fontPx ? prev : result.fontPx));
    setOverflow((prev) => (prev === result.overflow ? prev : result.overflow));
  }, [note.text]);

  const cleanupDrag = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  const applyPosition = useCallback(
    (clientX: number, clientY: number): boolean => {
      const origin = dragOriginRef.current;
      const z = zoomRef.current > 0 ? zoomRef.current : 1;
      const wx = origin.worldX + (clientX - origin.screenX) / z;
      const wy = origin.worldY + (clientY - origin.screenY) / z;
      return moveObject(doc, note.id, wx, wy);
    },
    [doc, note.id],
  );

  const applyFrame = useCallback(() => {
    rafRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p) return;
    const ok = applyPosition(p.x, p.y);
    if (!ok) {
      // Note disappeared mid-drag (stale id): end the interaction silently.
      cleanupDrag();
      draggingRef.current = false;
      pointerIdRef.current = null;
      setDragging(false);
      setPressed(false);
    }
  }, [applyPosition, cleanupDrag]);

  const scheduleDrag = useCallback(
    (x: number, y: number) => {
      pendingRef.current = { x, y };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(applyFrame);
      }
    },
    [applyFrame],
  );

  useEffect(() => cleanupDrag, [cleanupDrag]);

  const finishInteraction = useCallback(() => {
    cleanupDrag();
    draggingRef.current = false;
    pointerIdRef.current = null;
    setDragging(false);
    setPressed(false);
  }, [cleanupDrag]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      // The board must not pan when a note is grabbed.
      e.stopPropagation();
      if (editing) return;
      e.preventDefault();
      onSelect(note.id);
      const el = rootRef.current;
      if (el) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* not supported (jsdom) */
        }
      }
      pointerIdRef.current = e.pointerId;
      draggingRef.current = false;
      dragOriginRef.current = {
        screenX: e.clientX,
        screenY: e.clientY,
        worldX: note.x,
        worldY: note.y,
      };
      setPressed(true);
    },
    [editing, note.id, note.x, note.y, onSelect],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (pointerIdRef.current !== e.pointerId) return;
      e.stopPropagation();
      const origin = dragOriginRef.current;
      const dx = e.clientX - origin.screenX;
      const dy = e.clientY - origin.screenY;
      if (!draggingRef.current) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        draggingRef.current = true;
        setDragging(true);
        bringToFront(doc, note.id);
      }
      scheduleDrag(e.clientX, e.clientY);
    },
    [doc, note.id, scheduleDrag],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (pointerIdRef.current !== e.pointerId) return;
      e.stopPropagation();
      if (draggingRef.current && pendingRef.current) {
        // Apply the trailing position synchronously so the note ends under the pointer.
        const p = pendingRef.current;
        const ok = applyPosition(p.x, p.y);
        if (!ok) {
          finishInteraction();
          return;
        }
      }
      finishInteraction();
    },
    [applyPosition, finishInteraction],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (pointerIdRef.current !== e.pointerId) return;
      // The note stays where it was last shown.
      finishInteraction();
    },
    [finishInteraction],
  );

  const handleLostPointerCapture = useCallback(
    (e: React.PointerEvent) => {
      if (pointerIdRef.current !== e.pointerId) return;
      finishInteraction();
    },
    [finishInteraction],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // The viewport must not create a new note when a note is double-clicked.
      e.stopPropagation();
      if (editing) return;
      onSelect(note.id);
      onStartEdit(note.id);
    },
    [editing, note.id, onSelect, onStartEdit],
  );

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  // Note deleted while editing (or dragging) → end the interaction silently.
  useEffect(() => {
    if (editing && !ytext) onEndEdit('unselected');
  }, [editing, ytext, onEndEdit]);

  const handleColor = useCallback(
    (c: StickyColor) => {
      setStickyColor(doc, note.id, c);
    },
    [doc, note.id],
  );

  const handleDelete = useCallback(() => {
    deleteObject(doc, note.id);
  }, [doc, note.id]);

  const color = STICKY_COLORS[note.color];
  const showToolbar = selected && !editing && !dragging;

  return (
    <div
      data-testid="sticky-note-wrapper"
      data-note-id={note.id}
      data-x={note.x}
      data-y={note.y}
      data-z={note.z}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        zIndex: note.z,
      }}
    >
      <div
        ref={rootRef}
        role="group"
        aria-label="Sticky note"
        data-testid="sticky-note"
        data-note-id={note.id}
        data-selected={selected ? 'true' : 'false'}
        data-interaction={state}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onDoubleClick={handleDoubleClick}
        onFocus={() => {
          // Tab reaches the note: make it the selected note so Enter/Delete apply to it.
          if (!editing) onSelect(note.id);
        }}
        style={{
          position: 'absolute',
          inset: 0,
          background: color,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          borderRadius: '2px',
          outline: selected ? '2px solid #1976D2' : 'none',
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          overflow: 'hidden',
        }}
      >
        {/* hidden measuring element for auto-fit (same width and padding as the text layer) */}
        <div
          ref={measureRef}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: STICKY_SIZE_WORLD,
            visibility: 'hidden',
            pointerEvents: 'none',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            padding: `${NOTE_PADDING}px`,
            lineHeight: 1.3,
            fontFamily: 'inherit',
          }}
        >
          {note.text.length > 0 ? note.text : ' '}
        </div>
        <div
          data-testid="sticky-note-text"
          data-overflow={overflow ? 'true' : 'false'}
          className={overflow ? 'sticky-note-text' : 'sticky-note-text'}
          style={{
            position: 'absolute',
            inset: 0,
            padding: `${NOTE_PADDING}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textAlign: 'center',
            fontSize: `${fontPx}px`,
            lineHeight: 1.3,
            color: '#222',
            userSelect: 'none',
          }}
        >
          {note.text}
        </div>
        {overflow && (
          <div
            data-testid="sticky-note-fade"
            className="sticky-note-fade"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: `${Math.max(14, fontPx * 1.4)}px`,
              background: `linear-gradient(to bottom, rgba(255,255,255,0), ${color})`,
              pointerEvents: 'none',
            }}
          />
        )}
        {editing && counterVisible(note.text.length) && (
          <div
            data-testid="sticky-note-counter"
            style={{
              position: 'absolute',
              right: '6px',
              bottom: '4px',
              fontSize: '11px',
              color: 'rgba(0,0,0,0.55)',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            {note.text.length}/{STICKY_TEXT_MAX_CHARS}
          </div>
        )}
        {editing && ytext && (
          <StickyTextEditor
            key={note.id}
            ytext={ytext}
            fontPx={fontPx}
            padding={NOTE_PADDING}
            onEnd={onEndEdit}
          />
        )}
      </div>
      {showToolbar && (
        <div
          data-testid="note-toolbar-anchor"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            // Screen-space placement: translate by world units above the note, then
            // counter-scale so the toolbar keeps a constant pixel size at any zoom.
            transform: `scale(${1 / (zoom > 0 ? zoom : 1)}) translate(0px, ${-NOTE_TOOLBAR_OFFSET}px)`,
            transformOrigin: '0 0',
            zIndex: 10,
          }}
        >
          <NoteToolbar color={note.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}
