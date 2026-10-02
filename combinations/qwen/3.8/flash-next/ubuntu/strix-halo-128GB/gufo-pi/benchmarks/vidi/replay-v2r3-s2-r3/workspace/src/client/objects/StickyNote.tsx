import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import type { StickyColor } from '../../shared/config';
import { fitFontSize } from './StickyText';
import { STICKY_PADDING, StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Current board zoom; drag deltas in screen pixels are divided by it. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

const TOOLBAR_GAP = 8;
const SELECTION_COLOR = '#1976d2';

interface Press {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  baseX: number;
  baseY: number;
  dragging: boolean;
  raf: number | null;
}

/**
 * One sticky note: rendering, select, drag to move, double-click to edit.
 *
 * Interaction states (per client, never written to the document):
 * Unselected -> Pressed (pointerdown) -> Selected (pointerup within
 * DRAG_THRESHOLD_PX) or Dragging (moved at or beyond the threshold).
 * Selected -> Editing (dblclick or Enter). Editing -> Selected (Escape) or
 * Unselected (pointerdown outside). A note that disappears mid-interaction ends
 * the interaction silently.
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
  const elRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<Press | null>(null);
  const focusAfterEditRef = useRef(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const innerBox = STICKY_SIZE_WORLD - STICKY_PADDING * 2;

  // Auto-fit the text: measure only when the text changes (zoom scales uniformly).
  useEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    const next = fitFontSize(probe, innerBox);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next,
    );
  }, [note.text, innerBox]);

  // Return focus to the note when editing ends with the note still selected.
  useEffect(() => {
    if (focusAfterEditRef.current && !editing) {
      focusAfterEditRef.current = false;
      elRef.current?.focus();
    }
  }, [editing]);

  const endPress = useCallback(() => {
    const press = pressRef.current;
    if (press?.raf !== null && press?.raf !== undefined) {
      cancelAnimationFrame(press.raf);
    }
    if (press) {
      const el = elRef.current;
      if (el?.hasPointerCapture?.(press.pointerId)) el.releasePointerCapture(press.pointerId);
    }
    pressRef.current = null;
  }, []);

  // A note removed while dragging leaves nothing to move (no exception, no recreate).
  useEffect(() => endPress, [endPress]);

  const applyMove = useCallback(() => {
    const press = pressRef.current;
    if (!press) return;
    const z = zoomRef.current || 1;
    const nextX = press.baseX + (press.lastClientX - press.startClientX) / z;
    const nextY = press.baseY + (press.lastClientY - press.startClientY) / z;
    const applied = moveObject(doc, note.id, nextX, nextY);
    if (!applied && getStickyText(doc, note.id) === undefined) {
      // The note vanished (stale id): end the drag silently.
      endPress();
      setDragging(false);
    }
  }, [doc, note.id, endPress]);

  const scheduleMove = useCallback(() => {
    const press = pressRef.current;
    if (!press) return;
    if (press.raf !== null) return;
    press.raf = requestAnimationFrame(() => {
      const current = pressRef.current;
      if (!current) return;
      current.raf = null;
      applyMove();
    });
  }, [applyMove]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // The board must never pan when a note is pressed.
      event.stopPropagation();
      if (editing) return; // the textarea handles its own pointer
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const el = elRef.current;
      if (!el) return;
      pressRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        baseX: note.x,
        baseY: note.y,
        dragging: false,
        raf: null,
      };
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        /* jsdom */
      }
    },
    [editing, note.x, note.y],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;
      if (!press || event.pointerId !== press.pointerId) return;
      event.stopPropagation();
      press.lastClientX = event.clientX;
      press.lastClientY = event.clientY;

      if (!press.dragging) {
        const distance = Math.hypot(event.clientX - press.startClientX, event.clientY - press.startClientY);
        if (distance < DRAG_THRESHOLD_PX) return; // still Pressed
        press.dragging = true;
        bringToFront(doc, note.id);
        setDragging(true);
      }
      scheduleMove();
    },
    [doc, note.id, scheduleMove],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;
      if (!press || event.pointerId !== press.pointerId) return;
      event.stopPropagation();
      const wasDragging = press.dragging;
      if (wasDragging) {
        // Land exactly under the pointer instead of at the last frame.
        if (press.raf !== null) {
          cancelAnimationFrame(press.raf);
          press.raf = null;
        }
        applyMove();
      }
      endPress();
      if (wasDragging) setDragging(false);
      onSelect(note.id);
    },
    [applyMove, endPress, onSelect, note.id],
  );

  // Interrupted drag (pointercancel, lost capture): keep the last position.
  const handleInterrupt = useCallback(() => {
    const press = pressRef.current;
    if (!press) return;
    const wasDragging = press.dragging;
    endPress();
    if (wasDragging) {
      setDragging(false);
      onSelect(note.id);
    }
  }, [endPress, onSelect, note.id]);

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Editing this note instead of creating a new one on top of it.
      event.stopPropagation();
      onStartEdit(note.id);
    },
    [note.id, onStartEdit],
  );

  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      if (next === 'selected') focusAfterEditRef.current = true;
      onEndEdit(next);
    },
    [onEndEdit],
  );

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      ref={elRef}
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-testid={`sticky-note-${note.id}`}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handleInterrupt}
      onLostPointerCapture={handleInterrupt}
      onDoubleClick={handleDoubleClick}
      // Tab reaches the note; focusing it selects it so Enter can edit it
      onFocus={() => {
        if (!editing) onSelect(note.id);
      }}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        // Stacking comes from z (see App: DOM order stays by id)
        zIndex: note.z,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        boxSizing: 'border-box',
        backgroundColor: STICKY_COLORS[note.color],
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        borderRadius: 2,
        outline: selected ? `2px solid ${SELECTION_COLOR}` : 'none',
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        touchAction: 'none',
        fontFamily: 'inherit',
      }}
    >
      {/* Hidden measuring probe for the auto-fit font size */}
      <div
        ref={probeRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: innerBox,
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.25,
          fontFamily: 'inherit',
        }}
      >
        {note.text}
      </div>

      {!editing && (
        <div
          data-testid="sticky-text"
          className={fit.overflow ? 'sticky-text sticky-text-overflow' : 'sticky-text'}
          style={{
            position: 'absolute',
            inset: 0,
            boxSizing: 'border-box',
            padding: STICKY_PADDING,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textAlign: 'center',
            overflow: 'hidden',
            color: '#1f2933',
            fontSize: fit.fontPx,
            lineHeight: 1.25,
          }}
        >
          {note.text}
        </div>
      )}

      {!editing && fit.overflow && note.text.length > 0 && (
        <div
          data-testid="sticky-fade"
          className="sticky-text-fade"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 24,
            pointerEvents: 'none',
            background: `linear-gradient(to bottom, rgba(250,250,250,0) 0%, ${STICKY_COLORS[note.color]} 85%)`,
          }}
        />
      )}

      {editing && ytext && (
        <StickyTextEditor key={note.id} ytext={ytext} fontPx={fit.fontPx} onEnd={handleEndEdit} />
      )}

      {selected && !editing && !dragging && (
        <div
          data-testid="note-toolbar-anchor"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            transformOrigin: 'bottom left',
            transform: `scale(${1 / (zoom || 1)})`,
            paddingBottom: TOOLBAR_GAP / (zoom || 1),
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color: StickyColor) => {
              // Colour only: text, position, stacking and selection are untouched.
              setStickyColor(doc, note.id, color);
            }}
            onDelete={() => {
              // App clears the (now stale) selection when the note leaves the snapshot.
              deleteObject(doc, note.id);
            }}
          />
        </div>
      )}
    </div>
  );
}
