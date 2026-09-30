import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN, moveObjects } from '../../shared/board-model';
import {
  MAX_OBJECT_SIZE_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import {
  deleteIfEmpty,
  getTextContent,
  readTextLayoutInput,
  setTextWidthFixed,
  type TextSnapshot,
} from '../../shared/objects/text';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import { getTextMeasurer } from './textLayout';
import { remeasureText, useTextBoxSync } from './useTextBoxSync';

/**
 * One free text object (story 9): plain text with no background at its
 * stored box. Selection, moving, nudging and deleting are generic (story 7);
 * double-click (or Enter with it selected) edits. Local typing re-measures
 * and stores the box; ending an edit with no characters removes the object.
 */
export function TextObject(props: ObjectProps & { note?: TextSnapshot }) {
  const text = (props.note ?? props.object) as TextSnapshot;
  const { doc } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const undo = useUndoController();
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, text.id, getTextMeasurer());
  const fontPx = TEXT_SIZES[text.size];

  const ytext = props.editing ? getTextContent(doc, text.id) : undefined;
  const editing = props.editing && ytext !== undefined;

  // Text I just created (still empty when editing starts): its first typing joins
  // the creation step, so one undo removes the whole text, and abandoning it
  // empty removes the creation from the history too (never an invisible object).
  const freshRef = useRef<{ ytext: Y.Text; step: unknown } | null>(null);
  useEffect(() => {
    if (!ytext) return;
    const fresh = ytext.length === 0 && text.createdBy === localAuthor(doc);
    freshRef.current = fresh ? { ytext, step: undo.topStep() } : null;
    // Runs after the editor's own start boundary (child effects run first).
    if (fresh) undo.mergeNext();
    // Only when an edit session starts.
  }, [ytext]);

  // Leaving edit mode with the text still selected keeps keyboard focus on it.
  const wasEditing = useRef(props.editing);
  useEffect(() => {
    if (wasEditing.current && !props.editing && props.selected) {
      rootRef.current?.focus({ preventScroll: true });
    }
    wasEditing.current = props.editing;
  }, [props.editing, props.selected]);

  const { onEndEdit } = props;
  const onEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      const content = getTextContent(doc, text.id);
      // Deleted by someone else meanwhile: just stop editing.
      if (!content || content.doc === null || content._item?.deleted) {
        onEndEdit('unselected');
        return;
      }
      if (content.length === 0) {
        const fresh = freshRef.current;
        if (fresh?.ytext === content) {
          deleteIfEmpty(doc, text.id);
          undo.discardFrom(fresh.step);
        } else {
          // Removal joins the typing that emptied it: one undo restores the text.
          undo.mergeNext();
          deleteIfEmpty(doc, text.id);
        }
        freshRef.current = null;
        onEndEdit('unselected');
        return;
      }
      onEndEdit(next);
    },
    [doc, text.id, onEndEdit, undo],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation(); // the board must not pan
    if (props.editing) {
      if (e.target === e.currentTarget) e.preventDefault(); // keep focus in the textarea
      return;
    }
    props.onPointerDown(e, text.id);
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // never creates anything underneath
    if (!props.editing && !props.readOnly) props.onStartEdit(text.id);
  };

  const typography = {
    fontSize: `${fontPx}px`,
    lineHeight: TEXT_LINE_HEIGHT,
    fontFamily: TEXT_FONT_FAMILY,
  };

  return (
    <div
      ref={rootRef}
      className={`text-object board-object${props.gesture === 'dragging' ? ' is-dragging' : ''}`}
      role="group"
      aria-roledescription="text"
      aria-label={text.text.trim() === '' ? 'Empty text' : text.text}
      tabIndex={0}
      data-text-id={text.id}
      data-object-id={text.id}
      data-selected={props.selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-state={props.gesture}
      data-x={text.x}
      data-y={text.y}
      data-width={text.width}
      data-height={text.height}
      data-z={text.z}
      data-size={text.size}
      data-width-mode={text.widthMode}
      style={{
        left: text.x,
        top: text.y,
        width: text.width,
        height: text.height,
        zIndex: props.zIndex,
        ...typography,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="text-object-content"
        data-testid="text-content"
        style={{ visibility: editing ? 'hidden' : undefined }}
        aria-hidden="true"
      >
        {text.text}
      </div>
      {editing && ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={text.width}
          onInput={remeasureAfterLocalChange}
          onEnd={onEnd}
          undo={undo}
          label="Text"
          className="text-editor"
          style={{ lineHeight: TEXT_LINE_HEIGHT, fontFamily: TEXT_FONT_FAMILY }}
        />
      )}
    </div>
  );
}

const EPSILON = 1e-6;

/** This tab's author id for `createdBy` (story 6 identity is not part of this build). */
export function localAuthor(doc: Y.Doc): string {
  return `c_${doc.clientID}`;
}

/**
 * Registry resize hook for text (text.fixed_width): the object follows the
 * transformed selection box. When every selected object is text, the dragged
 * width becomes a fixed width; in mixed selections only fixed-width text
 * scales its width. Font size never changes, and the height is re-measured.
 */
export function resizeText(doc: Y.Doc, id: string, next: Rect, start: Rect, horizontalOnly: boolean): void {
  const input = readTextLayoutInput(doc, id);
  if (!input) return;
  let x = next.x;
  const scalesWidth = horizontalOnly || input.widthMode === 'fixed';
  if (scalesWidth) {
    // A width below the minimum is raised; a left-edge drag keeps the right edge in place.
    const width = Math.min(MAX_OBJECT_SIZE_WORLD, Math.max(TEXT_MIN_WIDTH_WORLD, next.width));
    const leftEdgeMoved = next.x !== start.x && Math.abs(next.x + next.width - (start.x + start.width)) < EPSILON;
    if (leftEdgeMoved) x = next.x + next.width - width;
  }
  doc.transact(() => {
    if (scalesWidth) setTextWidthFixed(doc, id, next.width);
    moveObjects(doc, new Map([[id, { x, y: horizontalOnly ? start.y : next.y }]]));
    remeasureText(doc, id, getTextMeasurer());
  }, LOCAL_ORIGIN);
}
