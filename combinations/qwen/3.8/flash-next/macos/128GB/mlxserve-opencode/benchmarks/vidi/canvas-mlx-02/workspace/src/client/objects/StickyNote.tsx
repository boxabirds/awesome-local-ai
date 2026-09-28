// A sticky note on the board (story 2), rendered through the story 7 generic
// object machinery: it draws itself (size included) and delegates the grab to
// useTransformGesture through `onObjectPointerDown`; in the generic path it owns
// no drag code. Selection/editing are props (never stored in the doc); all
// mutations go through the board-model.
//
// It accepts TWO prop shapes:
//  * ObjectProps (what the board renders, via the object registry) - the story 7
//    path: the pointer is handed to the shared gesture, which moves, resizes and
//    deletes whatever the selection contains, and whose SelectionBar shows the
//    note toolbar;
//  * the story 2 props (`note`, `onSelect`, `onColor`, `onDelete`, ...) - the
//    direct-mount path story 2's own component suite uses, which still drags the
//    note itself with moveObject. The board never uses this shape; it exists so
//    the story 2 suite can keep driving one note in isolation (see NOTES.md).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import {
  getStickyText,
  moveObject,
  bringToFront,
  type StickySnapshot,
  type ObjectSnapshot,
} from '../../shared/board-model.ts';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DRAG_THRESHOLD_PX,
  type StickyColor,
} from '../../shared/config.ts';
import { fitFontSize } from './StickyText.ts';
import { StickyTextEditor, StickyCharCounter } from './StickyTextEditor.tsx';
import { NoteToolbar } from './NoteToolbar.tsx';
import type { ObjectProps } from './registry.tsx';
import type { EndMode } from '../board/useSelection.ts';

const PADDING = 12;

function sizeOf(obj: ObjectSnapshot): { width: number; height: number } {
  return {
    width: typeof obj.width === 'number' && Number.isFinite(obj.width) && obj.width > 0 ? obj.width : STICKY_SIZE_WORLD,
    height: typeof obj.height === 'number' && Number.isFinite(obj.height) && obj.height > 0 ? obj.height : STICKY_SIZE_WORLD,
  };
}


export interface LegacyStickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * False while the board cannot be edited (story 4: the room could not load it).
   * A note then still renders and still lets the board be panned, but grabbing,
   * dragging, editing, recolouring and deleting it do nothing at all - the
   * model is never called.
   */
  editable?: boolean;
  onSelect(id: string | null): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndMode): void;
  onColor(id: string, color: string): void;
  onDelete(id: string): void;
}

export type StickyNoteProps = ObjectProps | LegacyStickyNoteProps;

function isLegacy(props: StickyNoteProps): props is LegacyStickyNoteProps {
  return (props as LegacyStickyNoteProps).note !== undefined;
}

type DragState = 'none' | 'pressed' | 'dragging';

export function StickyNote(props: StickyNoteProps): React.JSX.Element {
  const legacy = isLegacy(props);
  const obj: ObjectSnapshot = legacy ? (props as LegacyStickyNoteProps).note : (props as ObjectProps).obj;
  const doc = props.doc;
  const zoom = props.zoom;
  const selected = props.selected;
  const editing = props.editing;
  const editable = (props as { editable?: boolean }).editable ?? true;
  const note = obj as StickySnapshot; // sticky-specific fields (color, text)
  const legacyProps = legacy ? (props as LegacyStickyNoteProps) : null;
  const genericProps = legacy ? null : (props as ObjectProps);

  const elRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);

  const { width, height } = sizeOf(obj);
  // Text auto-fit measures inside the note's own box (story 7: resizing a note
  // re-fits its text).
  const contentW = Math.max(1, width - PADDING * 2);
  const contentH = Math.max(1, height - PADDING * 2);

  // Font auto-fit: run on mount and whenever the text or the box changes (never
  // on zoom - the world font scales uniformly with the board).
  const [fit, setFit] = useState({ fontPx: 24, overflow: false });
  // Reactive copy of the drag state so the floating toolbar hides while dragging.
  const [dragging, setDragging] = useState(false);

  const measure = useCallback(() => {
    const el = measureRef.current;
    if (!el) return;
    el.style.width = `${contentW}px`;
    el.textContent = note.text ?? '';
    const r = fitFontSize(el, contentH);
    setFit((prev) => (prev.fontPx === r.fontPx && prev.overflow === r.overflow ? prev : r));
  }, [note.text, contentW, contentH]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // ---- story 2 direct-mount drag (legacy shape only) -----------------------
  // Kept for the story 2 suite; the board renders the generic shape below and
  // never enters this branch, because useTransformGesture moves the selection.
  const drag = useRef({
    state: 'none' as DragState,
    pointerId: 0,
    startClientX: 0,
    startClientY: 0,
    startWorldX: 0,
    startWorldY: 0,
    lastX: 0,
    lastY: 0,
    raf: null as number | null,
  });

  const cancelDrag = useCallback(() => {
    const d = drag.current;
    if (d.raf != null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(d.raf);
      d.raf = null;
    }
    d.state = 'none';
  }, []);

  // Clean up a pending rAF on unmount.
  useEffect(() => () => cancelDrag(), [cancelDrag]);

  const flushMove = useCallback(() => {
    const d = drag.current;
    d.raf = null;
    const ok = moveObject(doc, obj.id, d.lastX, d.lastY);
    if (!ok) cancelDrag(); // note vanished mid-drag (TC-37)
  }, [doc, obj.id, cancelDrag]);

  const legacyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || legacyProps === null) return;
    // A read-only board does not swallow the press: panning over a note still
    // works, and nothing below this line can reach the model.
    if (!editable) return;
    e.stopPropagation(); // the board must never pan when a note is grabbed
    if (editing) return; // clicks inside the editor are handled there
    const d = drag.current;
    d.state = 'pressed';
    d.pointerId = e.pointerId;
    d.startClientX = e.clientX;
    d.startClientY = e.clientY;
    d.startWorldX = obj.x;
    d.startWorldY = obj.y;
    d.lastX = obj.x;
    d.lastY = obj.y;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* jsdom / unsupported */
    }
  };

  const legacyPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.state === 'none' || e.pointerId !== d.pointerId || legacyProps === null) return;
    e.stopPropagation();
    if (d.state === 'pressed') {
      const dx = e.clientX - d.startClientX;
      const dy = e.clientY - d.startClientY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still a possible click
      legacyProps.onSelect(obj.id);
      d.state = 'dragging';
      setDragging(true);
    }
    d.lastX = d.startWorldX + (e.clientX - d.startClientX) / zoom;
    d.lastY = d.startWorldY + (e.clientY - d.startClientY) / zoom;
    if (d.raf == null) d.raf = requestAnimationFrame(flushMove);
  };

  const legacyPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.state === 'none' || e.pointerId !== d.pointerId || legacyProps === null) return;
    e.stopPropagation();
    if (d.raf != null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(d.raf);
      d.raf = null;
    }
    const wasDragging = d.state === 'dragging';
    d.state = 'none';
    if (wasDragging) {
      // Commit the last shown position, then raise the note: reordering the DOM
      // mid-drag can drop pointer capture.
      moveObject(doc, obj.id, d.lastX, d.lastY);
      bringToFront(doc, obj.id);
      setDragging(false);
    }
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    // A short press (or the end of a drag) leaves the note selected.
    legacyProps.onSelect(obj.id);
  };

  // ---- generic (story 7) grab: the shared gesture owns everything ----------
  const genericPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!editable) return; // panning over a note still works on a read-only board
    e.stopPropagation(); // the board must never pan when a note is grabbed
    if (editing) return; // clicks inside the editor are handled there
    genericProps!.onObjectPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable) return; // the viewport's own create is gated the same way
    e.stopPropagation();
    if (editing) return;
    if (legacyProps) legacyProps.onStartEdit(obj.id);
    else genericProps!.onStartEdit(obj.id);
  };

  const endEdit = (next: EndMode) => {
    if (legacyProps) legacyProps.onEndEdit(next);
    else genericProps!.onEndEdit(next);
  };

  const ytext = getStickyText(doc, obj.id);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: obj.x,
    top: obj.y,
    width,
    height,
    background: STICKY_COLORS[note.color] ?? STICKY_COLORS.yellow,
    boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
    borderRadius: 2,
    color: '#202020',
    fontFamily: 'system-ui, sans-serif',
    cursor: editing ? 'text' : 'grab',
    boxSizing: 'border-box',
    outline: selected ? '2px solid #2563eb' : 'none',
    outlineOffset: 0,
    touchAction: 'none',
    pointerEvents: 'auto',
  };

  return (
    <div
      ref={elRef}
      role="group"
      aria-label="Sticky note"
      data-testid={`sticky-${obj.id}`}
      data-object-id={obj.id}
      data-selected={selected}
      data-editable={editable}
      data-editing={editing}
      data-width={width}
      data-height={height}
      tabIndex={0}
      style={style}
      onPointerDown={legacy ? legacyPointerDown : genericPointerDown}
      onPointerMove={legacy ? legacyPointerMove : undefined}
      onPointerUp={legacy ? legacyPointerEnd : undefined}
      onPointerCancel={legacy ? legacyPointerEnd : undefined}
      onLostPointerCapture={
        legacy
          ? () => {
              // Pointer captured then lost (e.g. released outside): keep last position.
              cancelDrag();
              setDragging(false);
            }
          : undefined
      }
      onDoubleClick={onDoubleClick}
    >
      {/* Hidden measuring mirror: same metrics as the visible text, used to pick
          the largest fitting font size. Invisible and non-interactive. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        data-testid={`sticky-measure-${obj.id}`}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: contentW,
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          lineHeight: 1.25,
          fontFamily: 'system-ui, sans-serif',
        }}
      />

      {/* Displayed text (hidden while editing, where the editor shows the text). */}
      <div
        data-testid={`sticky-text-${obj.id}`}
        className={`sticky-text${fit.overflow ? ' sticky-text-overflow' : ''}`}
        style={{
          position: 'absolute',
          inset: 0,
          padding: `${PADDING}px`,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          overflow: 'hidden',
          fontSize: `${fit.fontPx}px`,
          lineHeight: 1.25,
          visibility: editing && editable ? 'hidden' : 'visible',
          // The note frame owns pointer interaction; the rendered text is display-only.
          pointerEvents: 'none',
        }}
      >
        {note.text}
      </div>

      {editing && editable && ytext && <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={endEdit} />}
      {editing && editable && <StickyCharCounter length={(note.text ?? '').length} />}

      {/* The note toolbar: in the generic path the story 7 SelectionBar shows it
          above the selection instead, so it is rendered here only for the story 2
          direct-mount shape. Hidden while dragging or editing, and never shown on
          a board that cannot be edited. */}
      {legacy && selected && !editing && !dragging && editable && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            marginBottom: 6,
            transform: `scale(${1 / zoom})`,
            transformOrigin: 'bottom left',
            pointerEvents: 'auto',
          }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(c: StickyColor) => legacyProps!.onColor(obj.id, c)}
            onDelete={() => legacyProps!.onDelete(obj.id)}
          />
        </div>
      )}
    </div>
  );
}
