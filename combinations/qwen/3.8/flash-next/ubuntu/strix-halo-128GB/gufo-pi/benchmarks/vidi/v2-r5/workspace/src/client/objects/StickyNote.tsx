import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import { getStickyText, setStickyColor, type StickySnapshot } from '../../shared/board-model';
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
import { NOTE_FADE_SIZE, NOTE_LINE_HEIGHT_FACTOR, NOTE_PADDING } from './layout';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom, so overlays can counter-scale. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onToggle(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Bin button: delete the note and clear the selection (owned by `App`). */
  onDelete?(id: string): void;
  /** Pointer down handler from useTransformGesture (group move/resize). */
  onObjectPointerDown?(e: React.PointerEvent, id: string): void;
}

/**
 * One sticky note: renders it, delegates pointer interaction to the transform gesture,
 * and hosts the text editor and the note toolbar.
 */
export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onToggle,
  onStartEdit,
  onEndEdit,
  onDelete,
  onObjectPointerDown,
}: StickyNoteProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);

  const width = note.width ?? STICKY_SIZE_WORLD;
  const height = note.height ?? STICKY_SIZE_WORLD;

  /** Auto-fit: largest font size at which the text still fits, else overflow with a fade. */
  const measure = useCallback((): void => {
    const element = measureRef.current;
    if (!element) return;
    const innerHeight = height - 2 * NOTE_PADDING;
    const fit = fitFontSize(element, innerHeight);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [height]);

  useLayoutEffect(measure, [measure, note.text, editing]);

  const [interaction, setInteraction] = useState<'unselected' | 'pressed' | 'dragging'>('unselected');
  const interactionCleanupRef = useRef<(() => void) | null>(null);

  // Clean up interaction listener on unmount
  useEffect(() => () => { interactionCleanupRef.current?.(); }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    event.stopPropagation();
    if (editing) return;

    // Shift-click toggles selection without starting a gesture
    if (event.shiftKey) {
      onToggle(note.id);
      return;
    }

    if (onObjectPointerDown) {
      onObjectPointerDown(event, note.id);
    } else {
      onSelect(note.id);
    }

    // Track interaction state locally (data-interaction attribute for tests/CSS)
    setInteraction('pressed');
    const originX = event.clientX;
    const originY = event.clientY;
    const onMove = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - originX, e.clientY - originY);
      if (dist >= DRAG_THRESHOLD_PX) setInteraction('dragging');
    };
    const onUp = () => {
      setInteraction('unselected');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      interactionCleanupRef.current = null;
    };
    interactionCleanupRef.current?.();
    interactionCleanupRef.current = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
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
  const showToolbar = selected && !editing;
  const showCounter = editing && counterVisible(note.text.length);
  const innerWidth = width - 2 * NOTE_PADDING;

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
        width: `${width}px`,
        height: `${height}px`,
        background: STICKY_COLORS[note.color],
        zIndex: note.z,
        ['--sticky-fade' as string]: `${NOTE_FADE_SIZE}px`,
      } as React.CSSProperties}
      onPointerDown={handlePointerDown}
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
      {/* Hidden twin used only to measure the text */}
      <div
        ref={measureRef}
        className="sticky-note-measure"
        aria-hidden="true"
        data-testid="sticky-note-measure"
        style={{ width: `${innerWidth}px` }}
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
