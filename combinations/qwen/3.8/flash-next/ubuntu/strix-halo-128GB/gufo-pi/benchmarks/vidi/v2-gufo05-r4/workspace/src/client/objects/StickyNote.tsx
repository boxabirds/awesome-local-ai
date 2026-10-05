/**
 * One sticky note on the board.
 *
 * It renders the note from the document snapshot and owns the per-note
 * interaction state machine from the design:
 *
 *   Unselected --pointerdown--> Pressed --move >= DRAG_THRESHOLD_PX--> Dragging
 *   Pressed --pointerup--> Selected        Dragging --pointerup/cancel--> Selected
 *   Selected --dblclick / Enter--> Editing --Escape--> Selected
 *
 * Everything it does goes through `src/shared/board-model.ts`; the note itself
 * never stores state in the DOM, so a re-render from a document change (the
 * user's own, or in story 3 somebody else's) always shows the truth.
 */

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import type * as Y from 'yjs';
import {
  bringToFront,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot
} from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  NOTE_TOOLBAR_GAP_WORLD,
  STICKY_COLORS,
  STICKY_FADE_HEIGHT_PX,
  STICKY_FONT_MAX_PX,
  STICKY_LINE_HEIGHT,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  type StickyColor
} from '../../shared/config';
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';
import { fitFontSize } from './StickyText';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom, used for the drag maths and to keep the toolbar screen-sized. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * False while the board cannot be written to (story 4: the room could not load it).
   * The note still shows what it holds, and still selects, but nothing about it is
   * changed — a drag, an edit, a colour or a delete would be written into a document
   * that is about to be thrown away.
   */
  canEdit?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** Text size and overflow for a note's content box. */
interface Fit {
  fontPx: number;
  overflow: boolean;
}

/** A pointer press on a note, before we know whether it becomes a drag. */
interface Press {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  /** World position of the note's top-left when the press began. */
  originX: number;
  originY: number;
  moved: boolean;
  /** Latest pointer position; the frame callback turns it into a move. */
  pendingX: number;
  pendingY: number;
  frame: number | null;
}

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, onSelect, onStartEdit, onEndEdit } = props;
  const canEdit = props.canEdit !== false;
  // A board that has just become unwritable must not keep an open text box either.
  const editing = props.editing && canEdit;

  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<Press | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fit, setFit] = useState<Fit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  // Handlers registered once (or on window) read the latest values through refs.
  const latest = useRef({ note, doc, zoom, editing, canEdit, onSelect, onStartEdit, onEndEdit });
  latest.current = { note, doc, zoom, editing, canEdit, onSelect, onStartEdit, onEndEdit };

  const contentBox = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

  // Auto-fit: the largest font in the configured range in which all the text fits,
  // and whether it no longer fits even at the smallest size. Measuring needs real
  // layout, so jsdom always reports the largest size; the browser checks the rest.
  useLayoutEffect(() => {
    const element = measureRef.current;
    if (!element) return;
    const next = fitFontSize(element, contentBox);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next
    );
  }, [note.text, contentBox]);

  /** Write the note's new top-left, ending the drag if the note is gone. */
  const applyMove = useCallback((screenX: number, screenY: number) => {
    const press = pressRef.current;
    if (!press) return;
    const { doc: document, zoom: scale } = latest.current;
    const worldX = press.originX + (screenX - press.startClientX) / scale;
    const worldY = press.originY + (screenY - press.startClientY) / scale;
    // A note deleted by somebody else ends the interaction silently; the pointer
    // events are simply ignored from now on.
    if (!moveObject(document, latest.current.note.id, worldX, worldY)) {
      cancelFrame();
      pressRef.current = null;
      setDragging(false);
    }
  }, []);

  function cancelFrame(): void {
    const press = pressRef.current;
    if (press && press.frame !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(press.frame);
      else clearTimeout(press.frame);
      press.frame = null;
    }
  }

  /** At most one document write per animation frame, however many moves arrive. */
  const scheduleMove = useCallback((screenX: number, screenY: number) => {
    const press = pressRef.current;
    if (!press) return;
    press.pendingX = screenX;
    press.pendingY = screenY;
    if (press.frame !== null) return;
    const run = () => {
      const current = pressRef.current;
      if (!current) return;
      current.frame = null;
      applyMove(current.pendingX, current.pendingY);
    };
    press.frame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(run)
        : (setTimeout(run, 0) as unknown as number);
  }, [applyMove]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // A note owns its pointer events: the board must never start a pan under it.
    event.stopPropagation();
    if (event.button !== 0) return;
    // Clicking inside a note that is being typed into places the caret; it is not
    // a press on the note.
    if (latest.current.editing) return;

    const element = event.currentTarget;
    if (typeof element.setPointerCapture === 'function') {
      element.setPointerCapture(event.pointerId);
    }
    const { note: current } = latest.current;
    pressRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: current.x,
      originY: current.y,
      moved: false,
      pendingX: event.clientX,
      pendingY: event.clientY,
      frame: null
    };
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      const dx = event.clientX - press.startClientX;
      const dy = event.clientY - press.startClientY;
      if (!press.moved) {
        // A short press without movement stays a selection, not a drag.
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        // On a board that cannot be written to, a drag stays a click: the note is
        // selected and stays exactly where it is.
        if (!latest.current.canEdit) return;
        press.moved = true;
        // The note being moved comes to the front of everything it overlaps.
        bringToFront(latest.current.doc, note.id);
        setDragging(true);
      }
      scheduleMove(event.clientX, event.clientY);
    },
    [note.id, scheduleMove]
  );

  /** End the press: a plain press selects, a drag ends under the pointer. */
  const finishPress = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      cancelFrame();
      // The last move is applied here rather than in a frame, so the note ends
      // exactly under the pointer.
      if (press.moved) applyMove(event.clientX, event.clientY);
      pressRef.current = null;
      setDragging(false);
      // A drag that ended on a note that has since been deleted is simply over.
      if (getStickyText(latest.current.doc, note.id)) onSelect(note.id);
    },
    [applyMove, note.id, onSelect]
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      // Interrupted drags keep the last position the note was shown at.
      cancelFrame();
      pressRef.current = null;
      setDragging(false);
      onSelect(note.id);
    },
    [note.id, onSelect]
  );

  const handleDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    // A double-click on a note edits that note instead of creating a new one.
    event.stopPropagation();
    if (latest.current.editing || !latest.current.canEdit) return;
    onStartEdit(note.id);
  }, [note.id]);

  // A note that disappears mid-interaction is not rendered any more (the parent
  // builds this component from the document snapshot), so the press above is
  // never answered and the last pointer position simply stands.

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (!latest.current.canEdit) return;
      // Only the colour changes: text, position and the selection are untouched.
      setStickyColor(doc, note.id, color);
    },
    [doc, note.id]
  );

  const handleDelete = useCallback(() => {
    if (!latest.current.canEdit) return;
    deleteObject(doc, note.id);
    // The note is gone, so the selection goes with it.
    onEndEdit('unselected');
  }, [doc, note.id, onEndEdit]);

  const stopPointer = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  const noteStyle = {
    left: note.x,
    top: note.y,
    width: STICKY_SIZE_WORLD,
    height: STICKY_SIZE_WORLD,
    background: STICKY_COLORS[note.color],
    padding: STICKY_PADDING_WORLD,
    // The overflow fade blends into this note's own colour.
    '--sticky-fade': STICKY_COLORS[note.color],
    '--sticky-fade-height': `${STICKY_FADE_HEIGHT_PX}px`
  } as CSSProperties;

  const textStyle: CSSProperties = {
    fontSize: `${fit.fontPx}px`,
    lineHeight: STICKY_LINE_HEIGHT,
    alignItems: fit.overflow ? 'flex-start' : 'center'
  };

  const measureStyle: CSSProperties = {
    width: contentBox,
    lineHeight: STICKY_LINE_HEIGHT
  };

  const toolbarStyle: CSSProperties = {
    bottom: `calc(100% + ${NOTE_TOOLBAR_GAP_WORLD}px)`,
    transform: `scale(${1 / (zoom || 1)})`
  };

  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const interaction = dragging ? 'dragging' : editing ? 'editing' : 'idle';

  return (
    <div
      ref={rootRef}
      className="vidi6-sticky"
      data-vidi6="sticky"
      data-note-id={note.id}
      data-color={note.color}
      data-x={note.x}
      data-y={note.y}
      data-selected={selected ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      data-interaction={interaction}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={noteStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPress}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
    >
      {/* Off-screen measuring layer: same width and wrapping as the visible text. */}
      <div ref={measureRef} className="vidi6-sticky-measure" aria-hidden="true" style={measureStyle}>
        {note.text}
      </div>

      {editing && ytext ? (
        <div className="vidi6-sticky-edit" data-testid="sticky-edit" style={textStyle} onPointerDown={stopPointer}>
          <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
        </div>
      ) : (
        <div className="vidi6-sticky-text" data-testid="sticky-text" style={textStyle}>
          {note.text}
        </div>
      )}

      {/* Text that no longer fits is clipped inside the note and fades here. */}
      {fit.overflow ? <div className="vidi6-sticky-fade" data-testid="sticky-fade" aria-hidden="true" /> : null}

      {selected && !editing && !dragging ? (
        <div className="vidi6-note-toolbar-anchor" style={toolbarStyle}>
          <NoteToolbar
            color={note.color}
            onColor={handleColor}
            onDelete={handleDelete}
            disabled={!canEdit}
          />
        </div>
      ) : null}
    </div>
  );
}
