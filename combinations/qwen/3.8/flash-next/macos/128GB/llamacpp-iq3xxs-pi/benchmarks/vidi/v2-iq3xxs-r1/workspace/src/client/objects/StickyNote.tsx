import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import {
  deleteObject,
  getStickyText,
  setStickyColor,
  type StickySnapshot,
} from '../../shared/board-model';
import { fitFontSize, STICKY_TEXT_BOX_WORLD, STICKY_TEXT_PADDING_WORLD, type FontFit } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';
import type { UndoController } from '../board/undo';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** Camera zoom, so a drag keeps the grabbed point under the pointer. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Whether this note is currently being dragged by the transform gesture. */
  dragging?: boolean;
  /** False while the board cannot be edited (it failed to load): the note inert. */
  editable?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Story 7: delegated pointerdown for transform gesture. */
  onObjectPointerDown?(e: PointerEvent, id: string): void;
  /**
   * This tab's undo history (story 8): one colour change or one delete from this
   * note's toolbar is one step of its own, and typing in the note is stepped by the
   * same history (PRD undo.steps, undo.typing).
   */
  undo?: UndoController;
}

/**
 * One sticky note: rendering, selection highlight, double-click-to-edit and
 * its floating toolbar. Drag/move/resize is handled by the generic
 * useTransformGesture; StickyNote delegates pointerdown.
 */
export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  dragging = false,
  editable = true,
  onSelect,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  undo,
}: StickyNoteProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<FontFit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  // Latest props for the native listeners (attached once per note).
  const live = useRef({ note, zoom, editing, editable, onSelect, onStartEdit, onObjectPointerDown });
  live.current = { note, zoom, editing, editable, onSelect, onStartEdit, onObjectPointerDown };

  // ---------------------------------------------------------------- font fit
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const textBox = note.width != null ? note.width - STICKY_TEXT_PADDING_WORLD * 2 : STICKY_TEXT_BOX_WORLD;
    const next = fitFontSize(el, textBox);
    setFit((prev) => (prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next));
  }, [note.text, note.width]);

  // ------------------------------------------------------- select and pointer down
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const inside = (target: EventTarget | null, selector: string): boolean =>
      target instanceof Element && target.closest(selector) !== null;

    const onPointerDown = (event: PointerEvent): void => {
      if (live.current.editable === false) return;
      if (event.button !== 0) return;
      if (inside(event.target, '.sticky-note-input')) return;
      if (inside(event.target, '.note-toolbar')) return;
      if (inside(event.target, '.selection-handle')) return;
      event.stopPropagation();
      // Delegate to the transform gesture
      if (live.current.onObjectPointerDown) {
        live.current.onObjectPointerDown(event, live.current.note.id);
      } else {
        // Fallback: just select
        live.current.onSelect(live.current.note.id);
      }
    };

    const onDoubleClick = (event: MouseEvent): void => {
      if (live.current.editable === false) return;
      event.stopPropagation();
      event.preventDefault();
      live.current.onStartEdit(live.current.note.id);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('dblclick', onDoubleClick);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('dblclick', onDoubleClick);
    };
  }, []);

  const color = STICKY_COLORS[note.color];
  const ytext = editing ? getStickyText(doc, note.id) : undefined;
  const noteWidth = note.width ?? STICKY_SIZE_WORLD;
  const noteHeight = note.height ?? STICKY_SIZE_WORLD;
  const showToolbar = selected && !editing;

  return (
    <div
      ref={rootRef}
      className="sticky-note"
      data-note-root=""
      data-note-id={note.id}
      data-testid="sticky-note"
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-color={note.color}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={{
        left: note.x,
        top: note.y,
        width: noteWidth,
        height: noteHeight,
        background: color,
        outline: selected ? '2px solid #1a73e8' : 'none',
      }}
    >
      <div className={`sticky-text${fit.overflow ? ' sticky-text-overflow' : ''}`} data-testid="sticky-text">
        <div
          ref={textRef}
          className="sticky-text-inner"
          data-testid="sticky-text-inner"
          style={{ fontSize: `${fit.fontPx}px` }}
        >
          {note.text}
        </div>
        {fit.overflow ? (
          <div
            className="sticky-text-fade"
            data-testid="sticky-text-fade"
            aria-hidden="true"
            style={{ background: `linear-gradient(to bottom, ${color}00, ${color})` }}
          />
        ) : null}
      </div>

      {editing && ytext ? (
        <StickyTextEditor
          key={note.id}
          ytext={ytext}
          fontPx={fit.fontPx}
          onEnd={(next) => onEndEdit(next)}
          undo={undo}
        />
      ) : null}

      {showToolbar ? (
        <div
          className="note-toolbar-anchor"
          style={{
            left: noteWidth / 2,
            top: 0,
            transform: `scale(${1 / (zoom > 0 ? zoom : 1)})`,
          }}
        >
          <NoteToolbar
            color={note.color}
            disabled={!editable}
            onColor={(next: StickyColor) => {
              if (!editable) return;
              undo?.boundary();
              setStickyColor(doc, note.id, next);
              undo?.boundary();
            }}
            onDelete={() => {
              if (!editable) return;
              undo?.boundary();
              deleteObject(doc, note.id);
              undo?.boundary();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
