/**
 * Story 2 · task 5 — the sticky note (design "Sticky note interaction").
 *
 * One note is an absolutely positioned `div[role=group][aria-label="Sticky
 * note"]` in the (scaled) world layer at world `(x, y)`. Its pointer behaviour
 * comes from {@link useObjectInteraction}, the same generic hook the test-only
 * rectangle uses: a press selects (or, when the note is already part of a
 * multi-selection, keeps the group), and a drag past the threshold hands the
 * whole selection to the board's shared transform controller. Selection and
 * editing stay the parent's concern (props in, callbacks out); if a note
 * disappears mid-gesture the interaction simply ends.
 *
 * The note's text box is sized from the object's own `width`/`height` (which
 * default to the sticky size for documents that predate explicit sizes), so a
 * group resize written by the controller is reflected here without any
 * sticky-specific transform code.
 */
import { useEffect, useLayoutEffect, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import { getStickyText, setStickyColor, type ObjectSnapshot } from '../../shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../shared/config';
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';
import { fitText } from './StickyText';
import { useObjectInteraction } from './useObjectInteraction';
import type { TransformController } from '../board/transformController';
import type { UndoController } from '../board/undo';

export interface StickyNoteProps {
  note: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * False while the board is read-only (story 4: `load_failed`). Drag, text
   * editing, colour and delete all become no-ops; the note stays legible and
   * the board underneath still pans.
   */
  editable?: boolean;
  /** The board-wide transform controller (shared by every object). */
  controller: TransformController;
  /** The board-wide personal undo history (shared; story 8). */
  undo?: UndoController;
  /** The current selection, so a press can decide single-vs-group drag. */
  selection: readonly string[];
  /** Select this object alone, or (with `additive`) toggle it in the set. */
  onSelect(id: string, additive: boolean): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Clear the selection after the delete button removes this note. */
  onDelete(id: string): void;
}

/** Padding between the note edge and its text, in world units. */
const PADDING = 14;

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { note, doc, zoom, selected, editing, onSelect, onStartEdit, onDelete } = props;
  const { id, x, y } = note;
  const color: StickyColor = note.color ?? DEFAULT_STICKY_COLOR;
  const text = note.text ?? '';
  const width = note.width || STICKY_SIZE_WORLD;
  const height = note.height || STICKY_SIZE_WORLD;
  const editable = props.editable ?? true;

  const [displayFont, setDisplayFont] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
  });

  // A note deleted (via the model) mid-gesture ends its interaction silently:
  // no move after it is gone, and no re-creation (TC-37).
  const controller = props.controller;
  const selection = props.selection;
  const interaction = useObjectInteraction({
    id,
    isEditable: () => editable,
    isEditing: () => editing,
    getSelection: () => selection,
    onSelect: (objId, additive) => onSelect(objId, additive),
    getController: () => controller,
  });

  useEffect(() => {
    if (getStickyText(doc, id) === undefined) interaction.onPointerEnd({} as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, id, text]);

  // Auto-fit the *display* text (the editor fits its own textarea instead).
  useLayoutEffect(() => {
    if (editing) return;
    setDisplayFont(fitText(text, width - PADDING * 2, height - PADDING * 2));
  }, [text, editing, width, height]);

  const onDoubleClick = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!editable) return;
    if (!editing) onStartEdit(id);
  };

  // A lone selected note gets its own colour/delete toolbar; a group is handled
  // by the board-level selection bar instead.
  const groupSize = selection.length;
  const showToolbar = selected && groupSize <= 1 && !editing && interaction.phase === 'idle' && editable;
  const inverse = zoom > 0 ? 1 / zoom : 1;
  const ytext = editing ? getStickyText(doc, id) : undefined;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-testid={`note-${id}`}
      data-note-id={id}
      data-phase={interaction.phase}
      data-selected={selected ? 'true' : 'false'}
      data-editable={editable ? 'true' : 'false'}
      data-x={x}
      data-y={y}
      tabIndex={0}
      className="sticky-note"
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: STICKY_COLORS[color],
        pointerEvents: 'auto',
        touchAction: 'none',
        boxShadow: '0 6px 16px rgba(16, 24, 40, 0.18)',
        outline: selected ? '2px solid #2f6fed' : 'none',
      }}
      onPointerDown={interaction.onPointerDown}
      onPointerMove={interaction.onPointerMove}
      onPointerUp={interaction.onPointerEnd}
      onPointerCancel={interaction.onPointerEnd}
      onLostPointerCapture={interaction.onPointerEnd}
      onDoubleClick={onDoubleClick}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          initial={text}
          box={Math.min(width, height) - PADDING * 2}
          padding={PADDING}
          fontPx={STICKY_FONT_MAX_PX}
          onEnd={props.onEndEdit}
          undo={props.undo}
        />
      ) : (
        <div
          className={`sticky-content sticky-display${displayFont.overflow ? ' text-overflow-fade' : ''}`}
          data-testid="sticky-display"
          style={{
            padding: `${PADDING}px`,
            fontSize: `${displayFont.fontPx}px`,
            whiteSpace: 'pre-wrap',
            overflow: 'hidden',
          }}
        >
          {text}
        </div>
      )}

      {showToolbar ? (
        <div
          className="note-toolbar-anchor"
          style={{
            position: 'absolute',
            top: `${-36 * inverse}px`,
            left: '0px',
            transform: `scale(${inverse})`,
            transformOrigin: 'top left',
            pointerEvents: 'auto',
          }}
        >
          <NoteToolbar
            color={color}
            onColor={(next: StickyColor) => {
              if (!editable) return;
              // A recolour is its own undo step, separate from a drag that may
              // have just ended (TC-15: gesture + colour = two steps).
              if (props.undo) props.undo.step(() => setStickyColor(doc, id, next));
              else setStickyColor(doc, id, next);
            }}
            onDelete={() => onDelete(id)}
          />
        </div>
      ) : null}
    </div>
  );
}
