/**
 * A sticky note on the board: renders the note, delegates pointer interaction to the
 * generic transform gesture, and hosts the text editor while being edited.
 *
 * Story 7: own drag code removed; pointerdown delegates to `onObjectPointerDown`.
 */
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import * as Y from 'yjs';
import {
  deleteObject,
  getStickyText,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import type { EndEditNext } from '../board/useSelection';
import type { UndoController } from '../board/undo';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import { fitFontSize, STICKY_TEXT_BOX_WORLD } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Current board zoom, so text fit can account for it. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  dragging: boolean;
  /**
   * Whether this note may be changed (story 4). False while the room could not load the board:
   * the note can still be selected and read, but it cannot be dragged, typed in, recoloured or
   * deleted.
   */
  canEdit?: boolean;
  onSelect(id: string): void;
  onToggle(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next?: EndEditNext): void;
  /** The generic transform gesture handler for move and shift-click toggle. */
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  /** Story 8: this person's history, for the note's own commands and the text editor. */
  undo?: UndoController | null;
}

export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  dragging,
  canEdit = true,
  onSelect,
  onToggle,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  undo,
}: StickyNoteProps): JSX.Element {
  const textRef = useRef<HTMLDivElement | null>(null);
  const [fontPx, setFontPx] = useState(STICKY_FONT_MAX_PX);
  const [overflow, setOverflow] = useState(false);

  const ytext = useMemo(() => getStickyText(doc, note.id), [doc, note.id]);

  // The width/height of the note (story 7 additive)
  const w = note.width ?? STICKY_SIZE_WORLD;
  const h = note.height ?? STICKY_SIZE_WORLD;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    // the note toolbar handles its own clicks
    if (target?.closest('[data-note-toolbar]')) return;
    // stop propagation so the board viewport doesn't pan
    event.stopPropagation();
    if (editing) return; // typing is the textarea's business

    // Delegate to the generic transform gesture
    onObjectPointerDown(event, note.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // the board must not create a second note underneath this one
    event.stopPropagation();
    event.preventDefault();
    if (editing) return;
    onSelect(note.id);
    // no editing on a board that could not be loaded (story 4)
    if (!canEdit) return;
    onStartEdit(note.id);
  };

  // ---- auto-fit: the largest size at which the text still fits (world units, so it
  // scales with zoom and never needs re-measuring when the zoom changes) ----
  useLayoutEffect(() => {
    if (editing) return;
    const element = textRef.current;
    if (!element) return;
    const fit = fitFontSize(element, STICKY_TEXT_BOX_WORLD);
    setFontPx((previous) => (previous === fit.fontPx ? previous : fit.fontPx));
    setOverflow((previous) => (previous === fit.overflow ? previous : fit.overflow));
  }, [note.text, editing]);

  const style = {
    left: note.x,
    top: note.y,
    width: w,
    height: h,
    background: STICKY_COLORS[note.color],
    zIndex: note.z,
    '--note-padding': `${STICKY_PADDING_WORLD}px`,
    '--note-inverse-zoom': zoom > 0 ? String(1 / zoom) : '1',
  } as CSSProperties;

  return (
    <div
      className="sticky-note"
      data-board-object
      data-sticky-note
      data-note-id={note.id}
      data-selected={selected ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      data-overflow={overflow ? 'true' : undefined}
      data-testid="sticky-note"
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={style}
      onPointerDown={handlePointerDown}
      onDoubleClick={onDoubleClick}
    >
      {editing && ytext ? (
        <StickyTextEditor ytext={ytext} fontPx={fontPx} onEnd={onEndEdit} undo={undo} />
      ) : (
        <>
          <div
            ref={textRef}
            className="sticky-note__text"
            data-testid="sticky-note-text"
            style={{ fontSize: `${fontPx}px` }}
          >
            {note.text}
          </div>
          {overflow ? (
            <div className="sticky-note__fade" data-testid="note-fade" aria-hidden="true" />
          ) : null}
        </>
      )}
      {selected && !editing && !dragging ? (
        <NoteToolbar
          color={note.color}
          canEdit={canEdit}
          onColor={(color: StickyColor) => {
            if (!canEdit) return;
            // one chosen colour is one step, even when the same swatch is clicked again
            undo?.boundary();
            setStickyColor(doc, note.id, color);
            undo?.boundary();
          }}
          onDelete={() => {
            if (!canEdit) return;
            undo?.boundary();
            deleteObject(doc, note.id);
            undo?.boundary();
            onEndEdit('unselected');
          }}
        />
      ) : null}
    </div>
  );
}
