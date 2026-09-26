import {
  useMemo,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
  type TextSize,
} from '@/shared/config';
import {
  createCanvasMeasurer,
  type Measurer,
} from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import { getTextContent, type TextSnapshot } from '@/shared/objects/text';
import type { UndoController } from '../board/undo';

export interface TextObjectProps {
  note: TextSnapshot;
  doc: Y.Doc;
  /** Current camera zoom (screen px per world unit). */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * Story 4: false while the board failed to load. Selection stays possible
   * but edit-start is blocked (text.not_editable).
   */
  editable: boolean;
  /** Story 7: true while a group drag involving this object is active. */
  dragging: boolean;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /**
   * Story 7: pointerdown is delegated to the board's transform gesture
   * (select / shift-toggle / group move / single-text width drag).
   */
  onObjectPointerDown(e: ReactPointerEvent<HTMLDivElement>): void;
  /** Story 8: close the undo capture window (edit start/end). */
  onTextBoundary?: () => void;
  /** Story 8: undo inside the in-object editor (Ctrl/Cmd+Z). */
  onTextUndo?: () => void;
  /** Story 8: redo inside the in-object editor (Ctrl/Cmd+Shift+Z). */
  onTextRedo?: () => void;
}

const SELECTION_OUTLINE = '#1A73E8';

/**
 * A plain free-text object on the board (story 9). Renders the stored box
 * (width/height) at world (x, y) — the top-left anchor never moves when the
 * box re-measures (text.anchor); no fill, border or shadow. Editing goes
 * through the shared TextEditor; the stored box is re-measured after every
 * LOCAL change via useTextBoxSync (remote updates render the stored box as
 * synced, never remeasuring — Key decision 1).
 *
 * Select, move, nudge, delete, marquee and undo come from stories 7/8 via
 * the registry (text.consistent); the selection overlay shows only the e/w
 * handles for this type (text.fixed_width).
 */
export function TextObject(props: TextObjectProps): ReactElement {
  const {
    note, doc, selected, editing, editable, dragging,
    onStartEdit, onEndEdit, onObjectPointerDown,
    onTextBoundary, onTextUndo, onTextRedo,
  } = props;

  const size: TextSize =
    typeof note.size === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, note.size)
      ? (note.size as TextSize)
      : DEFAULT_TEXT_SIZE;
  const fontPx = TEXT_SIZES[size];
  const width = note.width !== undefined && Number.isFinite(note.width) ? note.width : 0;
  const height = note.height !== undefined && Number.isFinite(note.height) ? note.height : 0;

  // Width measurer: canvas in the browser, character-count estimate in
  // non-browser envs (layout.width). One per object is cheap (lazy ctx).
  const measure = useMemo<Measurer>(() => createCanvasMeasurer(), []);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id, measure);

  // Story 8: adapt the board's undo callbacks to the editor's controller.
  // The callback refs are refreshed each render so the (stable) controller
  // never captures a stale closure — same pattern as the sticky note.
  const undoCallbacks = useMemo(() => {
    const boundaryRef = { current: onTextBoundary };
    const undoRef = { current: onTextUndo };
    const redoRef = { current: onTextRedo };
    const controller: UndoController = {
      undo: () => {
        undoRef.current?.();
        return true;
      },
      redo: () => {
        redoRef.current?.();
        return true;
      },
      boundary: () => {
        boundaryRef.current?.();
      },
      canUndo: () => true,
      canRedo: () => true,
      addScope: () => {},
      onChange: () => () => {},
      destroy: () => {},
    };
    return { controller, boundaryRef, undoRef, redoRef };
  }, []);
  undoCallbacks.boundaryRef.current = onTextBoundary;
  undoCallbacks.undoRef.current = onTextUndo;
  undoCallbacks.redoRef.current = onTextRedo;

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    // The board must not pan when a press starts on an object (text.consistent);
    // the gesture stops propagation and drives select/toggle/move from here.
    onObjectPointerDown(e);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    // The viewport must not create a new object when one is double-clicked.
    e.stopPropagation();
    if (!editing && editable) onStartEdit(note.id);
  };

  const ytext = getTextContent(doc, note.id);

  return (
    <div
      data-testid="text-object"
      data-id={note.id}
      data-selected={selected ? true : undefined}
      role="group"
      aria-label={`Text: ${note.text}`}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: Math.max(width, 1),
        height: Math.max(height, 1),
        // Stacking via z-index (not DOM order), as with sticky notes.
        zIndex: note.z,
        outline: selected ? `2px solid ${SELECTION_OUTLINE}` : 'none',
        outlineOffset: 2,
        cursor: !editable ? 'default' : dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        fontFamily: TEXT_FONT_FAMILY,
        fontSize: `${fontPx}px`,
        lineHeight: TEXT_LINE_HEIGHT,
        color: 'rgba(0, 0, 0, 0.8)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        userSelect: 'none',
        boxSizing: 'border-box',
      }}
    >
      {editing && ytext !== undefined ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={note.widthMode === 'fixed' ? width : 'auto'}
          height={height}
          onInput={remeasureAfterLocalChange}
          onEnd={onEndEdit}
          undo={undoCallbacks.controller}
        />
      ) : (
        <div data-testid="text-content">{note.text}</div>
      )}
    </div>
  );
}
