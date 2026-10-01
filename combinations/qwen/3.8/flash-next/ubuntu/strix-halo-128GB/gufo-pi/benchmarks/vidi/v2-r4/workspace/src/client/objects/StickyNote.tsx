import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { StickySnapshot } from '../../shared/board-model';
import {
  deleteObject,
  getStickyText,
  setStickyColor,
} from '../../shared/board-model';
import {
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
} from '../../shared/config';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import { NoteToolbar } from './NoteToolbar';
import type { UndoController } from '../board/undo';

export interface StickyNoteProps {
  note: StickySnapshot;
  doc: Y.Doc;
  /** The board zoom: screen pixels are divided by it to get world units. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Delegate pointerdown to the transform gesture system. */
  onPointerDown?(e: React.PointerEvent<HTMLDivElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(): void;
  onDeleted?(id: string): void;
  undo?: UndoController;
}

/** Inner padding around the text, in world units. */
export const NOTE_PADDING_WORLD = 12;

/**
 * A sticky note, drawn inside the zoomed world layer at its world coordinates.
 *
 * - Press delegates to the transform gesture system (via onPointerDown prop).
 * - Double-click edits, as does the caller via Enter on a selected note.
 * - The text auto-fits its box and clips with a fade when it cannot shrink any further.
 * - Renders width/height from the snapshot (falls back to STICKY_SIZE_WORLD).
 */
export function StickyNote({
  note,
  doc,
  zoom,
  selected,
  editing,
  onPointerDown: onPointerDownProp,
  onStartEdit,
  onEndEdit,
  onDeleted,
  undo,
}: StickyNoteProps) {
  const textRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [fontFit, setFontFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const width = note.width ?? STICKY_SIZE_WORLD;
  const height = note.height ?? STICKY_SIZE_WORLD;

  const ytext = useMemo(() => getStickyText(doc, note.id), [doc, note.id]);

  // Auto-fit: the largest size at which the text still fits, and whether it
  // had to stop at the floor (which then clips with a fade).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const next = fitFontSize(el);
    setFontFit((prev) =>
      prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next,
    );
  }, [note.text, editing, note.id, width, height]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return; // the editor owns its own pointer input
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // A note owns its pointer: the board must not pan under it.
    event.stopPropagation();
    if (onPointerDownProp) {
      onPointerDownProp(event, note.id);
    }
  };

  // Editing ends on a pointerdown outside this note (a click on the board, on
  // another note, on the left toolbar). Capture phase, because notes and
  // toolbars stop propagation and a bubble listener would never run.
  useEffect(() => {
    if (!editing) return;
    const onDocumentPointerDown = (event: PointerEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (event.target instanceof Node && el.contains(event.target)) return;
      onEndEdit();
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  }, [editing, onEndEdit]);

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // Never falls through to the viewport's create gesture.
    event.stopPropagation();
    onStartEdit(note.id);
  };

  return (
    <div
      ref={rootRef}
      className="board-object sticky-note"
      role="group"
      data-testid="sticky-note"
      data-note-id={note.id}
      data-world-x={note.x}
      data-world-y={note.y}
      data-z={note.z}
      data-color={note.color}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      aria-label="Sticky note"
      style={{
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        background: `var(--note-${note.color})`,
      }}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <div
        ref={textRef}
        className={`sticky-note-text${fontFit.overflow ? ' fade-bottom' : ''}`}
        data-testid="sticky-note-text"
        data-overflow={fontFit.overflow ? 'true' : 'false'}
        aria-hidden={editing ? true : undefined}
        style={{
          padding: `${NOTE_PADDING_WORLD}px`,
          fontSize: `${fontFit.fontPx}px`,
          opacity: editing ? 0 : 1,
        }}
      >
        {note.text}
      </div>
      {editing && ytext ? (
        <StickyTextEditor
          key={note.id}
          ytext={ytext}
          fontPx={fontFit.fontPx}
          boxPx={width - NOTE_PADDING_WORLD * 2}
          onEnd={onEndEdit}
          undo={undo}
        />
      ) : null}
      {/* Hidden while editing: it would sit under the pointer. */}
      {selected ? (
        <div
          className="note-toolbar-anchor"
          data-testid="note-toolbar-anchor"
          style={{ transform: `scale(${zoom === 0 ? 1 : 1 / zoom})` }}
        >
          <NoteToolbar
            color={note.color}
            onColor={(color) => {
              undo?.boundary();
              setStickyColor(doc, note.id, color);
              undo?.boundary();
            }}
            onDelete={() => {
              undo?.boundary();
              deleteObject(doc, note.id);
              undo?.boundary();
              onDeleted?.(note.id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
