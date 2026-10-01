import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import { bringToFront, getStickyText, moveObject, setStickyColor, type StickySnapshot } from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { counterVisible, fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';
import { NOTE_FADE_SIZE, NOTE_INNER_SIZE, NOTE_LINE_HEIGHT_FACTOR, NOTE_PADDING } from './layout';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom, so a screen-space drag maps to world units and the note stays under the pointer. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Bin button: delete the note and clear the selection (owned by `App`). */
  onDelete?(id: string): void;
}

type Interaction = 'unselected' | 'pressed' | 'dragging';

interface DragState {
  pointerId: number;
  /** Pointer position at press, in screen pixels. */
  originX: number;
  originY: number;
  /** Note's top-left at press, in world units. */
  worldX: number;
  worldY: number;
  /** Latest pointer position while dragging (written on the next frame). */
  lastX: number;
  lastY: number;
  frame: number | null;
}

/**
 * One sticky note: renders it, owns its pointer interaction (select, drag) and hosts the text
 * editor and the note toolbar.
 *
 * Interaction states follow the design: Unselected → Pressed (pointerdown) → Selected
 * (pointerup without movement past `DRAG_THRESHOLD_PX`) or Dragging (movement beyond it).
 * A press stops propagation so the viewport never starts a pan, and the position written
 * during a drag is `world position + screen delta / zoom`, which keeps the grabbed point under
 * the pointer at any zoom. A drag ends on `pointercancel` too, keeping the last position shown.
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
  onDelete,
}: StickyNoteProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [interaction, setInteraction] = useState<Interaction>('unselected');
  const [overflow, setOverflow] = useState(false);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  /** Auto-fit: largest font size at which the text still fits, else overflow with a fade. */
  const measure = useCallback((): void => {
    const element = measureRef.current;
    if (!element) return;
    const fit = fitFontSize(element, NOTE_INNER_SIZE);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, []);

  useLayoutEffect(measure, [measure, note.text, editing]);

  /** Stop a drag without writing: used when the note disappears or the pointer is lost. */
  const stopDrag = useCallback((): void => {
    const drag = dragRef.current;
    if (drag && drag.frame !== null) cancelAnimationFrame(drag.frame);
    dragRef.current = null;
    setInteraction('unselected');
  }, []);

  // The note may vanish mid-drag (deleted by anyone): when the component unmounts, drop the
  // pending frame instead of touching a stale id (TC-37).
  useEffect(
    () => () => {
      const drag = dragRef.current;
      if (drag && drag.frame !== null) cancelAnimationFrame(drag.frame);
      dragRef.current = null;
    },
    [],
  );

  const writePosition = useCallback((): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const currentZoom = zoomRef.current || 1;
    const x = drag.worldX + (drag.lastX - drag.originX) / currentZoom;
    const y = drag.worldY + (drag.lastY - drag.originY) / currentZoom;
    // A rejected write means the note is gone: end the interaction silently.
    if (!moveObject(doc, note.id, x, y)) {
      stopDrag();
    }
  }, [doc, note.id, stopDrag]);

  const scheduleWrite = useCallback((): void => {
    const drag = dragRef.current;
    if (!drag || drag.frame !== null) return;
    drag.frame = requestAnimationFrame(() => {
      const current = dragRef.current;
      if (!current) return;
      current.frame = null;
      writePosition();
    });
  }, [writePosition]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    // The note owns this pointer: the board must not pan (sticky.no_pan).
    event.stopPropagation();
    if (editing) return;

    dragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      worldX: note.x,
      worldY: note.y,
      lastX: event.clientX,
      lastY: event.clientY,
      frame: null,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort (absent in jsdom).
    }
    setInteraction('pressed');
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    if (interaction !== 'dragging') {
      const distance = Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY);
      if (distance < DRAG_THRESHOLD_PX) return;
      // Dragging starts: raise the note once so it draws above anything it overlaps.
      bringToFront(doc, note.id);
      setInteraction('dragging');
      onSelect(note.id);
    }
    scheduleWrite();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const wasDragging = interaction === 'dragging';
    if (wasDragging && drag.frame !== null) {
      cancelAnimationFrame(drag.frame);
      drag.frame = null;
      writePosition();
    }
    dragRef.current = null;
    setInteraction('unselected');
    // A short press without movement selects the note; a drag leaves it selected too.
    onSelect(note.id);
  };

  const handlePointerCancel = (): void => {
    if (!dragRef.current) return;
    // An interrupted drag keeps the note where it was last shown.
    stopDrag();
    onSelect(note.id);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    // Editing an existing note must never create a new one (TC-35).
    event.stopPropagation();
    if (editing) return;
    onSelect(note.id);
    onStartEdit(note.id);
  };

  // While editing, a pointerdown anywhere outside the note ends editing and clears selection.
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (event: PointerEvent) => {
      const element = elementRef.current;
      if (element && event.target instanceof Node && element.contains(event.target)) return;
      onEndEdit('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing, onEndEdit]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const showToolbar = selected && !editing && interaction !== 'dragging';
  const showCounter = editing && counterVisible(note.text.length);

  return (
    <div
      ref={elementRef}
      className={overflow ? 'sticky-note sticky-note--overflow' : 'sticky-note'}
      data-testid="sticky-note"
      data-note-id={note.id}
      data-color={note.color}
      data-selected={selected ? 'true' : 'false'}
      data-interaction={interaction}
      data-overflow={overflow ? 'true' : 'false'}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${STICKY_SIZE_WORLD}px`,
        height: `${STICKY_SIZE_WORLD}px`,
        background: STICKY_COLORS[note.color],
        zIndex: note.z,
        // The bottom fade matches NOTE_FADE_SIZE, in board units.
        ['--sticky-fade' as string]: `${NOTE_FADE_SIZE}px`,
      } as React.CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} />
      ) : (
        <div
          className="sticky-note-text"
          data-testid="sticky-note-text"
          style={{
            fontSize: `${fontPx}px`,
            lineHeight: `${Math.round(fontPx * NOTE_LINE_HEIGHT_FACTOR)}px`,
            padding: `${NOTE_PADDING}px`,
          }}
        >
          {note.text}
        </div>
      )}
      {/* Hidden twin used only to measure the text: its width is the text box, so the font fit
          does not depend on how the visible text is aligned or clipped. */}
      <div
        ref={measureRef}
        className="sticky-note-measure"
        aria-hidden="true"
        data-testid="sticky-note-measure"
        style={{ width: `${NOTE_INNER_SIZE}px` }}
      >
        {note.text}
      </div>
      {overflow && (
        <div
          className="sticky-note-fade"
          data-testid="sticky-note-fade"
          style={{ height: `${NOTE_FADE_SIZE}px` }}
        />
      )}
      {showCounter && (
        <div className="sticky-note-counter" data-testid="sticky-note-counter">
          {`${note.text.length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      )}
      {showToolbar && (
        <NoteToolbar
          color={note.color}
          zoom={zoom}
          onColor={(color) => {
            // Only the colour field is written: text, position, stacking and the local
            // selection are untouched, so the note stays selected exactly where it was.
            setStickyColor(doc, note.id, color);
          }}
          onDelete={() => {
            onDelete?.(note.id);
          }}
        />
      )}
    </div>
  );
}
