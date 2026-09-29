/**
 * Story 9 · task 8 — the free-text object (design "TextObject").
 *
 * One text object is an absolutely positioned `div[role=group][aria-label="Text"]`
 * in the (scaled) world layer at world `(x, y)`, sized from its own stored
 * `width` / `height` and drawn at the current size preset's font size with
 * `white-space: pre-wrap` (no fill, no background). Its pointer behaviour comes
 * from the same generic {@link useObjectInteraction} hook as the sticky note and
 * the test rectangle, so selection, group move and horizontal resize are all
 * shared and carry no text-specific transform code.
 *
 * Editing reuses the generalised {@link TextEditor}: a double-click (or `Enter`
 * on a lone selection, handled by the board keyboard) opens it; every keystroke
 * rewrites the stored box through {@link createTextBoxSync} so the measured width
 * and height travel with the text (and revert with it on undo); and when editing
 * ends an empty object removes itself. A remote delete during editing simply ends
 * the session (the object vanishes, the editor unmounts — no error).
 */
import { useEffect, useMemo, useRef, type JSX } from 'react';
import type * as Y from 'yjs';
import {
  deleteIfEmpty,
  getTextContent,
  getTextSize,
  isEmptyText,
  setTextSize,
} from '../../shared/objects/text';
import { TEXT_MAX_CHARS, TEXT_SIZES, type TextSize } from '../../shared/config';
import { TextEditor } from './TextEditor';
import { TextToolbar } from './TextToolbar';
import { useObjectInteraction } from './useObjectInteraction';
import { createTextBoxSync } from './useTextBoxSync';
import { createCanvasMeasurer, layoutText } from './textLayout';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { TransformController } from '../board/transformController';
import type { UndoController } from '../board/undo';

export interface TextObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable?: boolean;
  controller: TransformController;
  undo?: UndoController;
  selection: readonly string[];
  onSelect(id: string, additive: boolean): void;
  onStartEdit(id: string): void;
  /** Editing ended with content kept (the editor calls this with 'selected'). */
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Remove this object (empty-on-end, or the toolbar Delete). */
  onDelete(id: string): void;
}

/** Padding between the text edge and its box, in world units. */
const PADDING = 8;

export function TextObject(props: TextObjectProps): JSX.Element {
  const { obj, doc, zoom, selected, editing, onSelect, onStartEdit, onDelete } = props;
  const { id, x, y } = obj;
  const size = getTextSize(doc, id) as TextSize;
  const text = obj.text ?? '';
  const width = obj.width || 200;
  const height = obj.height || TEXT_SIZES[size] * 1.3;
  const editable = props.editable ?? true;
  const fontPx = TEXT_SIZES[size];

  // One measurer and one box-sync per object, rebuilt only when the object's
  // geometry-relevant fields change. The layout reads the live stored box.
  const measure = useMemo(() => createCanvasMeasurer(), []);
  const syncRef = useRef<ReturnType<typeof createTextBoxSync> | null>(null);
  if (syncRef.current === null) {
    syncRef.current = createTextBoxSync(doc, id, measure, layoutText);
  }

  const interaction = useObjectInteraction({
    id,
    isEditable: () => editable,
    isEditing: () => editing,
    getSelection: () => props.selection,
    onSelect: (objId, additive) => onSelect(objId, additive),
    getController: () => props.controller,
  });

  // A text object deleted (or emptied-and-removed) mid-gesture ends its
  // interaction silently: no move after it is gone, no re-creation.
  useEffect(() => {
    if (getTextContent(doc, id) === undefined) interaction.onPointerEnd({} as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, id, text]);

  // Editing ends (Escape, an outside click, or a remote delete): drop an object
  // that is now empty so an abandoned heading never lingers as invisible text.
  const endEdit = () => {
    if (isEmptyText(doc, id)) {
      // A run of typing plus its box write is one undo step; the removal happens
      // in that same step so one Ctrl+Z brings the text back with its box.
      const remove = () => deleteIfEmpty(doc, id);
      if (props.undo) props.undo.step(remove);
      else remove();
      props.onDelete(id);
    } else {
      props.onEndEdit('selected');
    }
  };

  const groupSize = props.selection.length;
  const showToolbar = selected && groupSize <= 1 && !editing && interaction.phase === 'idle' && editable;
  const inverse = zoom > 0 ? 1 / zoom : 1;
  const ytext = editing ? getTextContent(doc, id) : undefined;

  // A double-click anywhere on the box opens the editor (criterion: double-click
  // an existing text box edits it). Stopped so it never reaches the board surface.
  const onDoubleClick = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!editable) return;
    if (!editing) onStartEdit(id);
  };

  return (
    <div
      role="group"
      aria-label="Text"
      data-testid={`text-${id}`}
      data-text-id={id}
      data-phase={interaction.phase}
      data-selected={selected ? 'true' : 'false'}
      data-editable={editable ? 'true' : 'false'}
      data-x={x}
      data-y={y}
      data-width={width}
      data-height={height}
      data-size={size}
      tabIndex={0}
      className="text-object"
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'auto',
        touchAction: 'none',
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
        <TextEditor
          ytext={ytext}
          initial={text}
          maxChars={TEXT_MAX_CHARS}
          box={Math.max(1, width - PADDING * 2)}
          padding={PADDING}
          fontPx={fontPx}
          onEnd={endEdit}
          undo={props.undo}
          onEdit={() => {
            // The local change rewrites the stored box, in the same capture
            // window, so one undo restores text *and* dimensions together.
            syncRef.current?.remeasureAfterLocalChange();
          }}
          ariaLabel="Text content"
          testId={`text-editor-${id}`}
        />
      ) : (
        <div
          className="text-content text-display"
          data-testid="text-display"
          style={{
            padding: `${PADDING}px`,
            fontSize: `${fontPx}px`,
            lineHeight: 1.3,
            whiteSpace: 'pre-wrap',
            overflow: 'hidden',
          }}
        >
          {text}
        </div>
      )}

      {showToolbar ? (
        <div
          className="text-toolbar-anchor"
          style={{
            position: 'absolute',
            top: `${-36 * inverse}px`,
            left: '0px',
            transform: `scale(${inverse})`,
            transformOrigin: 'top left',
            pointerEvents: 'auto',
          }}
        >
          <TextToolbar
            size={size}
            onSize={(next) => {
              if (!editable) return;
              const apply = () => {
                if (!setTextSize(doc, id, next)) return;
                const sync = createTextBoxSync(doc, id, measure, layoutText);
                sync.remeasureAfterLocalChange();
              };
              // A size change (and the box it rewrites) is its own undo step.
              if (props.undo) props.undo.step(apply);
              else apply();
            }}
            onDelete={() => onDelete(id)}
          />
        </div>
      ) : null}
    </div>
  );
}
