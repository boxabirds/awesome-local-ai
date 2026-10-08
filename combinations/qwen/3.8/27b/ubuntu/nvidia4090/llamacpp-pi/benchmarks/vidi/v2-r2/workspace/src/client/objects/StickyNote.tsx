import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import { bringToFront, getStickyText, moveObject } from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SELECTION_OUTLINE,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_PADDING,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

/** The full inner box the text may occupy, in board units. */
const TEXT_BOX = STICKY_SIZE_WORLD - STICKY_TEXT_PADDING * 2;
const LINE_HEIGHT = 1.2;
const INK_COLOR = '#3c3c34';
const TEXT_FAMILY =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

type DragPhase = 'idle' | 'pressed' | 'dragging';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /**
   * When true (persist.client_status load_failed) the note can still be
   * selected but drag and text editing are no-ops, so a load-failed board
   * can never be mutated.
   */
  disabled?: boolean;
  /**
   * Report whether this note is mid-drag. Used by the board (and tests) to
   * hide the floating note toolbar while a drag is in flight, so a
   * pointerup never lands on a swatch and recolors by accident.
   */
  onDraggingChange?(id: string | null): void;
}

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onEndEdit, onDraggingChange, disabled = false } = props;

  const textRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  // ---- display-mode font fitting (runs when text changes / editing stops)
  useEffect(() => {
    if (editing) {
      return;
    }
    const el = textRef.current;
    if (el === null) {
      return;
    }
    setFit(fitFontSize(el, TEXT_BOX));
  }, [note.text, editing]);

  // ---- drag state machine (all in refs: no React re-render per move)
  const phaseRef = useRef<DragPhase>('idle');
  const startRef = useRef<{ clientX: number; clientY: number; worldX: number; worldY: number } | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const applyPending = useCallback((): void => {
    rafRef.current = null;
    const p = pendingRef.current;
    if (p !== null) {
      pendingRef.current = null;
      moveObject(doc, note.id, p.x, p.y);
    }
  }, [doc, note.id]);

  const schedulePending = useCallback((): void => {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(applyPending);
    }
  }, [applyPending]);

  // Clean up any in-flight rAF and drag report on unmount (e.g. the note was
  // deleted mid-drag, TC-37) so the board never keeps a stale drag id.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      if (phaseRef.current === 'dragging') {
        onDraggingChange?.(null);
      }
    };
    // onDraggingChange is a stable setState in the board; the effect only
    // needs to run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (editing) {
      return; // the textarea owns pointer events (caret placement)
    }
    if (disabled) {
      // load_failed: selection is allowed but drag is a no-op.
      e.stopPropagation();
      onSelect(note.id);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;
    }
    // A note press must never pan the board (sticky.no_pan).
    e.stopPropagation();
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      el.setPointerCapture(e.pointerId);
    }
    phaseRef.current = 'pressed';
    startRef.current = { clientX: e.clientX, clientY: e.clientY, worldX: note.x, worldY: note.y };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const phase = phaseRef.current;
    const start = startRef.current;
    if (phase === 'idle' || start === null) {
      return;
    }
    const dx = e.clientX - start.clientX;
    const dy = e.clientY - start.clientY;
    if (phase === 'pressed') {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return; // still a plain press, not a drag yet
      }
      phaseRef.current = 'dragging';
      onDraggingChange?.(note.id);
      bringToFront(doc, note.id); // sticky.bring_front: at drag start only
    }
    // World delta = screen delta / zoom. The start position is captured at
    // pointer-down and never changes, so the grabbed point stays under the
    // pointer even while the camera zooms mid-drag.
    pendingRef.current = {
      x: start.worldX + dx / zoomRef.current,
      y: start.worldY + dy / zoomRef.current,
    };
    schedulePending();
  };

  const finishDrag = (e: { stopPropagation(): void } | null, flush: boolean): void => {
    if (phaseRef.current === 'idle') {
      return;
    }
    e?.stopPropagation();
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (flush) {
        // Clean pointerup: apply the final position so the grabbed point
        // ends exactly under the pointer.
        applyPending();
      }
      // Interrupted drag (cancel / lost capture): the note stays where it
      // was last displayed; drop the unflushed pending position.
      pendingRef.current = null;
    }
    const wasDragging = phaseRef.current === 'dragging';
    phaseRef.current = 'idle';
    startRef.current = null;
    if (wasDragging) {
      onDraggingChange?.(null);
    }
    onSelect(note.id); // both "press + release" and a finished drag select
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    finishDrag(e, true);
  };

  const onPointerCancel = (): void => {
    finishDrag(null, false);
  };

  const onLostPointerCapture = (): void => {
    finishDrag(null, false);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    // Double-clicking a note edits it; it must never fall through to the
    // board and create a second note (TC-35).
    e.stopPropagation();
    if (disabled) {
      return; // load_failed: editing is locked out
    }
    if (!editing) {
      onStartEdit(note.id);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (editing) {
      return; // the textarea owns the keys
    }
    if (disabled) {
      return; // load_failed: editing is locked out
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onSelect(note.id);
      onStartEdit(note.id);
    }
  };

  const ytext = editing ? (getStickyText(doc, note.id) ?? null) : null;

  return (
    <div
      data-sticky-note={note.id}
      data-testid="sticky-note"
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      style={{
        position: 'absolute',
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        zIndex: note.z,
        background: STICKY_COLORS[note.color],
        borderRadius: 4,
        boxShadow: selected
          ? '0 1px 4px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.22)'
          : '0 1px 4px rgba(0,0,0,0.18)',
        outline: selected ? STICKY_SELECTION_OUTLINE : 'none',
        outlineOffset: 2,
        pointerEvents: 'auto',
        cursor: editing ? 'text' : disabled ? 'default' : 'grab',
        fontFamily: TEXT_FAMILY,
        boxSizing: 'border-box',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {editing && ytext !== null ? (
        <StickyTextEditor ytext={ytext} fontPx={STICKY_FONT_MAX_PX} onEnd={onEndEdit} />
      ) : (
        <>
          <div
            ref={textRef}
            data-testid="sticky-note-text"
            style={{
              position: 'absolute',
              inset: STICKY_TEXT_PADDING,
              overflow: 'hidden',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: `${fit.fontPx}px`,
              lineHeight: String(LINE_HEIGHT),
              color: INK_COLOR,
              pointerEvents: 'none',
            }}
          >
            {note.text}
          </div>
          {fit.overflow && (
            <div
              data-testid="sticky-fade"
              className="sticky-note-fade"
              style={{
                position: 'absolute',
                left: STICKY_TEXT_PADDING,
                right: STICKY_TEXT_PADDING,
                bottom: 0,
                height: 28,
                background: 'linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.22))',
                pointerEvents: 'none',
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
