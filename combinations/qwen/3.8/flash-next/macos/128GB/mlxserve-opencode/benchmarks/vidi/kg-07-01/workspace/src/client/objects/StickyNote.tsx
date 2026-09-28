import { memo, useContext, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type * as Y from 'yjs';
import {
  deleteObject,
  getStickyText,
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

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False while the board cannot be edited: no drag, text edit, colour or delete. Default true. */
  editable?: boolean;
  /** CSS stacking position (1 = bottom). Omitted: DOM order decides. */
  stackIndex?: number;
  /** When true, this note is the only selected object: show the note toolbar. */
  showNoteToolbar?: boolean;
  onSelect(id: string): void;
  onToggleSelect?(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Transform gesture delegation. */
  onPointerDownGesture?(e: PointerEvent, id: string): void;
  onPointerMoveGesture?(e: PointerEvent): void;
  onPointerUpGesture?(e: PointerEvent): void;
  onPointerCancelGesture?(e: PointerEvent): void;
}

function StickyNoteImpl(props: StickyNoteProps) {
  const { note, doc, zoom, selected, editing } = props;
  const editable = props.editable ?? true;
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false, contentHeight: 0 });
  const overlay = useContext(WorldOverlayContext);
  const latest = useRef(props);
  latest.current = props;

  // Track gesture phase: when the gesture starts moving, set phase to 'dragging'.
  // We need a local ref to know when we've started.
  const pressRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);

  const w = note.width ?? STICKY_SIZE_WORLD;
  const h = note.height ?? STICKY_SIZE_WORLD;

  // Auto-fit the font on mount and whenever the text or size changes.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const { fontPx, overflow } = fitFontSize(el, w);
    const contentHeight = contentRef.current?.offsetHeight ?? 0;
    setFit((f) =>
      f.fontPx === fontPx && f.overflow === overflow && f.contentHeight === contentHeight
        ? f
        : { fontPx, overflow, contentHeight },
    );
  }, [note.text, w]);

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const lineHeight = fit.fontPx * STICKY_LINE_HEIGHT;
  const editorPaddingTop = Math.max(
    STICKY_PADDING_WORLD,
    (h - Math.max(fit.contentHeight, lineHeight)) / 2,
  );

  const className = ['sticky-note'];
  if (selected) className.push('sticky-note--selected');
  if (editing) className.push('sticky-note--editing');
  if (fit.overflow) className.push('sticky-note--overflow');
  if (phase === 'dragging') className.push('sticky-note--dragging');

  const style = {
    left: note.x,
    top: note.y,
    width: w,
    height: h,
    zIndex: props.stackIndex,
    '--note-color': STICKY_COLORS[note.color],
    '--zoom': zoom,
    '--note-padding': `${STICKY_PADDING_WORLD}px`,
    '--note-line-height': STICKY_LINE_HEIGHT,
  } as CSSProperties;

  const showToolbar = (props.showNoteToolbar ?? (editable && selected)) && !editing && phase !== 'dragging';
  const toolbar = showToolbar ? (
    <div
      className="note-toolbar-anchor"
      style={{ left: note.x + w / 2, top: note.y, '--zoom': zoom } as CSSProperties}
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
        if (e.target === e.currentTarget && !selected) props.onSelect(note.id);
      }}
      onPointerDown={(e) => {
        // Never let a press on a note reach the board (no pan, no deselect).
        e.stopPropagation();
        if (editing || e.button !== 0) return;

        // Shift+click toggles selection without starting a gesture.
        if (e.shiftKey) {
          props.onToggleSelect?.(note.id);
          return;
        }

        // Track local press state for visual feedback.
        if (pressRef.current === null) {
          pressRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
          setPhase('pressed');
        }

        // Delegate to transform gesture.
        if (props.onPointerDownGesture) {
          props.onPointerDownGesture(e.nativeEvent, note.id);
        } else {
          props.onSelect(note.id);
        }

        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // Synthetic or already-released pointer.
        }
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        const p = pressRef.current;
        if (p && e.pointerId === p.pointerId) {
          const dx = e.clientX - p.startX;
          const dy = e.clientY - p.startY;
          if (!p.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
            p.moved = true;
            setPhase('dragging');
          }
        }
        if (props.onPointerMoveGesture) props.onPointerMoveGesture(e.nativeEvent);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        pressRef.current = null;
        setPhase('idle');
        if (props.onPointerUpGesture) props.onPointerUpGesture(e.nativeEvent);
      }}
      onPointerCancel={(e) => {
        pressRef.current = null;
        setPhase('idle');
        if (props.onPointerCancelGesture) props.onPointerCancelGesture(e.nativeEvent);
      }}
      onLostPointerCapture={(e) => {
        if (pressRef.current?.pointerId === e.pointerId) {
          pressRef.current = null;
          setPhase('idle');
        }
        if (props.onPointerCancelGesture) props.onPointerCancelGesture(e.nativeEvent);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing && editable) props.onStartEdit(note.id);
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
