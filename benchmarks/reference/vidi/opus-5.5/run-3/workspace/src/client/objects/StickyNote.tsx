import { memo, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
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
  STICKY_LINE_HEIGHT,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import { WorldOverlayContext } from '../canvas/worldOverlay';
import { NoteToolbar } from './NoteToolbar';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

type Phase = 'idle' | 'pressed' | 'dragging';

interface Press {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  dragging: boolean;
  targetX: number;
  targetY: number;
  frame: number | null;
}

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** CSS stacking position (1 = bottom). Omitted: DOM order decides. */
  stackIndex?: number;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

function StickyNoteImpl(props: StickyNoteProps) {
  const { note, doc, zoom, selected, editing } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<Press | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false, contentHeight: 0 });
  const overlay = useContext(WorldOverlayContext);
  const latest = useRef(props);
  latest.current = props;

  // Auto-fit the font on mount and whenever the text changes (not on zoom: text is in world units).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const { fontPx, overflow } = fitFontSize(el, STICKY_SIZE_WORLD);
    const contentHeight = contentRef.current?.offsetHeight ?? 0;
    setFit((f) =>
      f.fontPx === fontPx && f.overflow === overflow && f.contentHeight === contentHeight
        ? f
        : { fontPx, overflow, contentHeight },
    );
  }, [note.text]);

  const applyMove = useCallback(() => {
    const p = pressRef.current;
    if (!p) return;
    p.frame = null;
    moveObject(latest.current.doc, latest.current.note.id, p.targetX, p.targetY);
  }, []);

  /**
   * Ends a press or drag. With `release` (pointerup), a drag is written at the release point;
   * otherwise (cancel, lost capture) the note stays where it was last shown.
   */
  const finishPress = useCallback((release?: { clientX: number; clientY: number }) => {
    const p = pressRef.current;
    if (!p) return;
    if (p.frame !== null) {
      cancelAnimationFrame(p.frame);
      p.frame = null;
    }
    if (release && p.dragging) {
      const zoom = latest.current.zoom;
      const x = p.originX + (release.clientX - p.startX) / zoom;
      const y = p.originY + (release.clientY - p.startY) / zoom;
      moveObject(latest.current.doc, latest.current.note.id, x, y);
    }
    pressRef.current = null;
    const el = rootRef.current;
    try {
      if (el?.hasPointerCapture?.(p.pointerId)) el.releasePointerCapture(p.pointerId);
    } catch {
      // The pointer is already gone.
    }
    setPhase('idle');
    latest.current.onSelect(latest.current.note.id);
  }, []);

  // Unmounted mid-drag (note deleted): drop the pending frame, nothing else to undo.
  useEffect(
    () => () => {
      const p = pressRef.current;
      if (p?.frame != null) cancelAnimationFrame(p.frame);
      pressRef.current = null;
    },
    [],
  );

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const lineHeight = fit.fontPx * STICKY_LINE_HEIGHT;
  const editorPaddingTop = Math.max(
    STICKY_PADDING_WORLD,
    (STICKY_SIZE_WORLD - Math.max(fit.contentHeight, lineHeight)) / 2,
  );

  const className = ['sticky-note'];
  if (selected) className.push('sticky-note--selected');
  if (editing) className.push('sticky-note--editing');
  if (fit.overflow) className.push('sticky-note--overflow');
  if (phase === 'dragging') className.push('sticky-note--dragging');

  const style = {
    left: note.x,
    top: note.y,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    zIndex: props.stackIndex,
    '--note-color': STICKY_COLORS[note.color],
    '--zoom': zoom,
    '--note-padding': `${STICKY_PADDING_WORLD}px`,
    '--note-line-height': STICKY_LINE_HEIGHT,
  } as CSSProperties;

  const showToolbar = selected && !editing && phase !== 'dragging';
  const toolbar = showToolbar ? (
    <div
      className="note-toolbar-anchor"
      style={{ left: note.x + STICKY_SIZE_WORLD / 2, top: note.y, '--zoom': zoom } as CSSProperties}
    >
      <NoteToolbar
        color={note.color}
        onColor={(c) => setStickyColor(doc, note.id, c)}
        onDelete={() => deleteObject(doc, note.id)}
      />
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={className.join(' ')}
      role="group"
      aria-label="Sticky note"
      data-note-id={note.id}
      data-selected={selected}
      data-state={editing ? 'editing' : phase}
      data-color={note.color}
      data-overflow={fit.overflow}
      tabIndex={0}
      style={style}
      onFocus={(e) => {
        // Keyboard users reach notes with Tab; focusing one selects it (presses select on release instead).
        if (e.target === e.currentTarget && !selected && pressRef.current === null) props.onSelect(note.id);
      }}
      onPointerDown={(e) => {
        // Never let a press on a note reach the board (no pan, no deselect).
        e.stopPropagation();
        if (editing || e.button !== 0 || pressRef.current !== null) return;
        pressRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          originX: note.x,
          originY: note.y,
          dragging: false,
          targetX: note.x,
          targetY: note.y,
          frame: null,
        };
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // Synthetic or already-released pointer: moves still arrive while over the note.
        }
        setPhase('pressed');
      }}
      onPointerMove={(e) => {
        const p = pressRef.current;
        if (!p || e.pointerId !== p.pointerId) return;
        e.stopPropagation();
        const dx = e.clientX - p.startX;
        const dy = e.clientY - p.startY;
        if (!p.dragging) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          p.dragging = true;
          setPhase('dragging');
          bringToFront(doc, note.id);
        }
        p.targetX = p.originX + dx / zoom;
        p.targetY = p.originY + dy / zoom;
        if (p.frame === null) p.frame = requestAnimationFrame(applyMove);
      }}
      onPointerUp={(e) => {
        const p = pressRef.current;
        if (!p || e.pointerId !== p.pointerId) return;
        e.stopPropagation();
        finishPress({ clientX: e.clientX, clientY: e.clientY });
      }}
      onPointerCancel={(e) => {
        if (pressRef.current?.pointerId === e.pointerId) finishPress();
      }}
      onLostPointerCapture={(e) => {
        if (pressRef.current?.pointerId === e.pointerId) finishPress();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing) props.onStartEdit(note.id);
      }}
    >
      <div
        ref={textRef}
        className="sticky-note__text"
        style={{ fontSize: `${fit.fontPx}px` }}
        aria-hidden={editing || undefined}
      >
        <div ref={contentRef} className="sticky-note__content">
          {note.text}
        </div>
      </div>
      {editing && ytext && (
        <StickyTextEditor
          ytext={ytext}
          fontPx={fit.fontPx}
          paddingTop={editorPaddingTop}
          onEnd={(next) => {
            props.onEndEdit(next);
            // Escape leaves the note selected: keep keyboard focus on it (Enter edits again, Delete deletes).
            if (next === 'selected') rootRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
      {toolbar && (overlay ? createPortal(toolbar, overlay) : toolbar)}
    </div>
  );
}

/** A sticky note in the world layer: select, drag to move, double-click to edit, toolbar when selected. */
export const StickyNote = memo(StickyNoteImpl);
