// One sticky note in the world layer: renders, selects, drags, starts editing
// and hosts the note toolbar. Interaction states (Pressed -> Selected/Dragging)
// are local component state, never written to the Y.Doc.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
} from '../../shared/config';
import { STICKY_TEXT_BOX_WORLD, fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** false while the board could not be loaded: drag, edit, colour, delete. */
  editable: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

interface DragState {
  phase: 'pressed' | 'dragging';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
  pendingDx: number;
  pendingDy: number;
  raf: number | null;
}

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  editable,
  onSelect,
  onStartEdit,
  onEndEdit,
}: StickyNoteProps): React.JSX.Element | null {
  const dragRef = useRef<DragState | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [dragging, setDragging] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const textRef = useRef<HTMLDivElement | null>(null);

  // Text auto-fit for display mode (real layout exists only in a browser; in
  // jsdom scrollHeight is 0, so the fit stays at the maximum size).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const result = fitFontSize(el, STICKY_TEXT_BOX_WORLD);
    setOverflow(result.overflow);
    setFontPx(result.fontPx);
  }, [note.text, editing]);

  const stopDrag = useCallback((): boolean => {
    const d = dragRef.current;
    if (!d) return false;
    if (d.raf !== null) {
      cancelAnimationFrame(d.raf);
      d.raf = null;
    }
    let gone = false;
    if (d.phase === 'dragging') {
      // Keep the last position shown under the pointer.
      const ok = moveObject(
        doc,
        note.id,
        d.startWorldX + d.pendingDx / zoomRef.current,
        d.startWorldY + d.pendingDy / zoomRef.current,
      );
      gone = !ok; // note deleted mid-drag (TC-37): end silently
    }
    dragRef.current = null;
    setDragging(false);
    return gone;
  }, [doc, note.id]);

  const handleRelease = useCallback(() => {
    const had = dragRef.current !== null;
    stopDrag();
    if (had) onSelect(note.id);
  }, [stopDrag, onSelect, note.id]);

  useEffect(
    () => () => {
      const d = dragRef.current;
      if (d && d.raf !== null) cancelAnimationFrame(d.raf);
      dragRef.current = null;
    },
    [],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (editing) return; // caret placement inside the textarea stays with the editor
    if (!editable) return; // load_failed: no drag (the board pans behind instead)
    // The board must not pan when a drag starts on a note (sticky.no_pan).
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture unsupported (e.g. jsdom): moves on the element still work.
    }
    dragRef.current = {
      phase: 'pressed',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startWorldX: note.x,
      startWorldY: note.y,
      pendingDx: 0,
      pendingDy: 0,
      raf: null,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startClientX;
    const dy = e.clientY - d.startClientY;
    if (d.phase === 'pressed') {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      d.phase = 'dragging';
      setDragging(true);
      bringToFront(doc, note.id);
    }
    d.pendingDx = dx;
    d.pendingDy = dy;
    if (d.raf === null) {
      d.raf = requestAnimationFrame(() => {
        const cur = dragRef.current;
        if (!cur) return;
        cur.raf = null;
        const ok = moveObject(
          doc,
          note.id,
          cur.startWorldX + cur.pendingDx / zoomRef.current,
          cur.startWorldY + cur.pendingDy / zoomRef.current,
        );
        if (!ok) {
          dragRef.current = null;
          setDragging(false);
        }
      });
    }
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      className="sticky-note"
      tabIndex={0}
      style={
        {
          left: note.x,
          top: note.y,
          width: STICKY_SIZE_WORLD,
          height: STICKY_SIZE_WORLD,
          background: STICKY_COLORS[note.color],
          '--note-bg': STICKY_COLORS[note.color],
          '--note-zoom': zoom,
          zIndex: note.z,
        } as React.CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={handleRelease}
      onPointerCancel={handleRelease}
      onLostPointerCapture={handleRelease}
      onDoubleClick={(e) => {
        e.stopPropagation(); // never create a second note here (TC-35)
        if (!editing && editable) onStartEdit(note.id);
      }}
    >
      {editing && editable ? (
        ytext ? (
          <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} />
        ) : null
      ) : (
        <div
          ref={textRef}
          className={overflow ? 'sticky-text sticky-overflow' : 'sticky-text'}
          data-testid="sticky-text"
        >
          {note.text}
        </div>
      )}
      {selected && !dragging && !editing && editable && (
        <div className="note-toolbar-wrap">
          <NoteToolbar
            color={note.color}
            onColor={(c) => {
              setStickyColor(doc, note.id, c);
            }}
            onDelete={() => {
              deleteObject(doc, note.id);
            }}
          />
        </div>
      )}
    </div>
  );
}
