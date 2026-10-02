import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import {
  getStickyText,
  bringToFront,
  moveObject,
  setStickyColor,
  deleteObject,
} from '../../shared/board-model';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DRAG_THRESHOLD_PX,
  STICKY_FONT_MAX_PX,
  type StickyColor,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

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

type Phase = 'idle' | 'pressed' | 'dragging';

/**
 * A single sticky note in the world layer. Runs its own press → select / drag
 * state machine and mounts the text editor while editing. Selection and
 * editing live in the parent (never stored in the doc); mutations go through
 * the board model so the Y.Doc stays the single source of truth.
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
}: StickyNoteProps) {
  const [dragging, setDragging] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const phaseRef = useRef<Phase>('idle');
  const pressRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Latest note available to stable handlers without rebinding every render.
  const noteRef = useRef(note);
  noteRef.current = note;

  // Display text auto-fit (needs browser layout; harmless no-op in jsdom).
  useLayoutEffect(() => {
    if (editing) return;
    const el = contentRef.current;
    if (!el) return;
    el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
    const result = fitFontSize(el, el.clientHeight);
    setOverflow(result.overflow);
  }, [note.text, editing]);

  const cancelRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => cancelRaf, [cancelRaf]);

  // End a press/drag: flush the last position and become selected. Idempotent.
  const finishInteraction = useCallback(() => {
    if (phaseRef.current === 'idle') return;
    cancelRaf();
    const pending = pendingRef.current;
    if (pending) {
      moveObject(doc, noteRef.current.id, pending.x, pending.y);
      pendingRef.current = null;
    }
    phaseRef.current = 'idle';
    pressRef.current = null;
    setDragging(false);
    onSelect(noteRef.current.id);
  }, [doc, cancelRaf, onSelect]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (editing) return; // the textarea handles interactions while editing
      e.stopPropagation(); // the board must not start a pan
      // No preventDefault(): it would suppress the browser's synthesized dblclick
      // (used to enter edit mode). The note already uses user-select: none.
      const el = e.currentTarget as HTMLElement;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* jsdom / unsupported: ignore */
      }
      pressRef.current = { sx: e.clientX, sy: e.clientY, ox: note.x, oy: note.y };
      phaseRef.current = 'pressed';
    },
    [editing, note.x, note.y],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (phaseRef.current === 'idle' || !pressRef.current) return;
      const p = pressRef.current;
      const dx = e.clientX - p.sx;
      const dy = e.clientY - p.sy;

      if (phaseRef.current === 'pressed') {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still a possible click
        bringToFront(doc, noteRef.current.id); // raise once, at the start of the drag
        phaseRef.current = 'dragging';
        setDragging(true);
      }

      // Divide the screen delta by the camera zoom so the grabbed point stays
      // under the pointer at any zoom (TC-31 / TC-32).
      pendingRef.current = { x: p.ox + dx / zoomRef.current, y: p.oy + dy / zoomRef.current };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const pos = pendingRef.current;
          if (!pos) return;
          const ok = moveObject(doc, noteRef.current.id, pos.x, pos.y);
          if (!ok) {
            // Note disappeared mid-drag: end the interaction silently.
            phaseRef.current = 'idle';
            setDragging(false);
          }
        });
      }
    },
    [doc],
  );

  const handlePointerUp = useCallback(() => finishInteraction(), [finishInteraction]);
  const handlePointerCancel = useCallback(() => finishInteraction(), [finishInteraction]);
  const handleLostPointerCapture = useCallback(() => finishInteraction(), [finishInteraction]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onStartEdit(note.id);
    },
    [onStartEdit, note.id],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onStartEdit(note.id);
      }
    },
    [onStartEdit, note.id],
  );

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const showToolbar = selected && !editing && !dragging;

  return (
    <div
      data-sticky-note
      data-note-id={note.id}
      data-testid="sticky-note"
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        zIndex: note.z,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: STICKY_COLORS[note.color],
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
        boxSizing: 'border-box',
        outline: selected ? '2px solid #1a73e8' : 'none',
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
    >
      <div
        data-testid="sticky-clip"
        style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
      >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={STICKY_FONT_MAX_PX} onEnd={onEndEdit} />
      ) : (
        <div
          ref={contentRef}
          data-testid="sticky-display"
          style={{
            position: 'absolute',
            inset: 0,
            padding: 12,
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            color: '#1c1c1c',
            lineHeight: 1.25,
            fontSize: STICKY_FONT_MAX_PX,
          }}
        >
          {note.text}
          {overflow && (
            <div
              data-testid="note-overflow-fade"
              className="note-overflow-fade"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 24,
                pointerEvents: 'none',
                background:
                  'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.85))',
              }}
            />
          )}
        </div>
      )}
      </div>

      {showToolbar && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            transform: `scale(${1 / zoom})`,
            transformOrigin: 'bottom left',
            paddingBottom: 6,
            boxSizing: 'border-box',
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(c: StickyColor) => setStickyColor(doc, note.id, c)}
            onDelete={() => {
              // The note vanishing from the snapshot clears selection in App.
              deleteObject(doc, note.id);
            }}
          />
        </div>
      )}
    </div>
  );
}
