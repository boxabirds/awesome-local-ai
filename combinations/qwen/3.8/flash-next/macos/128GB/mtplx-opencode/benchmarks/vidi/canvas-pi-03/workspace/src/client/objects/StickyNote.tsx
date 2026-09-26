import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import { getStickyText } from '../../shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DRAG_THRESHOLD_PX, STICKY_FONT_MAX_PX } from '../../shared/config';
import { TransformGesture } from '../board/transform-gesture';
import { StickyTextEditor } from './StickyTextEditor';
import { fitFontSize } from './StickyText';
import type { StickyColor } from '../../shared/config';

const PADDING = 12; // world units of text padding on each side

interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  /** True when this note takes part in the selection (it is one of the ids). */
  selected: boolean;
  /** The group that moves with this note: the whole selection when the note is
   * part of it, just itself otherwise (contract `sel.transform`). */
  groupIds: readonly string[];
  /** The board's shared transform gesture (contract `sel.transform`). */
  gesture: TransformGesture;
  editing: boolean;
  /** False while the board could not be loaded: the note cannot be dragged or
   * edited (PRD persist.load_failure). Defaults to true. */
  editable?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

type Mode = 'idle' | 'pressed' | 'dragging';

/** True when the note exists in the document (guards stale-id interactions). */
function noteAlive(doc: Y.Doc, id: string): boolean {
  return doc.getMap<Y.Map<unknown>>('objects').has(id);
}

export function StickyNote({ note, doc, zoom, selected, groupIds, gesture, editing, editable = true, onSelect, onStartEdit, onEndEdit }: StickyNoteProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const modeRef = useRef<Mode>('idle');
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const start = useRef({ px: 0, py: 0, x: 0, y: 0, moved: false });
  const wasGroup = useRef(false);
  const pressSelected = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState<number>(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState<boolean>(false);

  // Recompute the auto-fit font whenever the text changes or on mount. The font
  // is authored in world units, so this is not run on zoom (zoom scales it
  // uniformly) — see design "Sticky note text editing and fit".
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || editing) return;
    const box = STICKY_SIZE_WORLD - 2 * PADDING;
    const fit = fitFontSize(el, box);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [note.text, editing]);

  const endDrag = useCallback(() => {
    if (modeRef.current === 'dragging') {
      modeRef.current = 'idle';
      setMode('idle');
    }
  }, []);

  // If the note disappears mid-interaction, end silently (TC-37).
  useEffect(() => {
    if (!noteAlive(doc, note.id)) {
      modeRef.current = 'idle';
      setMode('idle');
    }
  }, [doc, note.id]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // A Shift+press belongs to the board, not to the note: it draws a selection
    // rectangle even when it starts on top of this note (contract `sel.marquee`,
    // TC-35). Only an unmodified press becomes a note drag.
    if (e.shiftKey) return;
    // The board must never pan because of a press on a note.
    e.stopPropagation();
    if (editing || !editable) return; // no drag, no selection while uneditable

    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, x: note.x, y: note.y, moved: false };
    modeRef.current = 'pressed';
    setMode('pressed');
    wasGroup.current = selected && groupIds.length > 1;
    pressSelected.current = selected;
    // A press that turns into a drag moves the whole selection when the pressed
    // note was already part of it, and only itself otherwise. An unselected
    // note is selected when the drag starts (contract `sel.drag_unselected`).
    const group = selected && groupIds.length > 1 ? [...groupIds] : [note.id];
    // The gesture owns the write: it moves the whole group, raises it once at
    // gesture start, and skips ids a peer deleted mid-drag.
    gesture.beginMove(group, {
      x: e.clientX,
      y: e.clientY,
    });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const m = modeRef.current;
    if (m === 'idle') return;
    e.stopPropagation();
    if (!noteAlive(doc, note.id)) {
      gesture.reset();
      endDrag();
      return;
    }
    const dx = e.clientX - start.current.px;
    const dy = e.clientY - start.current.py;
    const dist = Math.hypot(dx, dy);
    if (dist < DRAG_THRESHOLD_PX) return; // stay Pressed until we clear the threshold

    if (m === 'pressed') {
      modeRef.current = 'dragging';
      setMode('dragging');
      // Dragging a note that was not selected selects it (and only it).
      if (!pressSelected.current) onSelect(note.id);
    }

    // The gesture converts the screen delta to world units (divide by zoom) and
    // writes every member in ONE transaction.
    gesture.update({ x: e.clientX, y: e.clientY }, dist);
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (modeRef.current === 'pressed') {
      // A short press with no movement selects the note alone (contract
      // `sel.interaction`: a click replaces the set).
      onSelect(note.id);
    }    gesture.reset();
    endDrag();
  };

  const onDoubleClick = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editing && editable) onStartEdit(note.id);
  };

  const color = STICKY_COLORS[note.color as StickyColor] ?? STICKY_COLORS.yellow;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      data-mode={mode}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: STICKY_SIZE_WORLD,
        height: STICKY_SIZE_WORLD,
        backgroundColor: color,
        boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        pointerEvents: 'auto',
        outline: selected ? '2px solid #2563eb' : 'none',
        outlineOffset: 0,
        // Text is authored in world units; the world layer's zoom scale makes
        // it grow/shrink with the board.
        fontSize: fontPx,
        color: '#111',
      }}
    >
      {editing ? (
        <StickyTextEditor
          key="edit"
          ytext={getStickyText(doc, note.id)!}
          fontPx={fontPx}
          padding={PADDING}
          onEnd={onEndEdit}
        />
      ) : (
        <div
          ref={contentRef}
          data-testid="sticky-display"
          style={{
            position: 'absolute',
            inset: 0,
            padding: PADDING,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            textAlign: 'center',
            lineHeight: 1.25,
            fontSize: fontPx,
            color: '#111',
          }}
        >
          {note.text}
        </div>
      )}

      {overflow && (
        <div
          data-testid="sticky-fade"
          className="sticky-overflow"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 28,
            background: 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.85))',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}