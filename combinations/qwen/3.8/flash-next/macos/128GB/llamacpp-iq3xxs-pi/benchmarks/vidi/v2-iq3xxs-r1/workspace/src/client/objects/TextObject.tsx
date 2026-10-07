import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { deleteIfEmpty, setTextSize, type TextWidthMode } from '../../shared/objects/text';
import { TEXT_MAX_CHARS, TEXT_SIZES, type TextSize } from '../../shared/config';
import { TextEditor } from './TextEditor';
import { useTextBoxSync } from './useTextBoxSync';
import { TextToolbar } from '../board/TextToolbar';
import type { Measurer } from './textLayout';
import type { UndoController } from '../board/undo';

/** A text object without its text: what the board's snapshots carry. */
export interface TextObjectProps {
  /** The board document this text lives in (the same one every object shares). */
  doc: Y.Doc;
  id: string;
  size: TextSize;
  x: number;
  y: number;
  width: number;
  height: number;
  widthMode: TextWidthMode;
  /** Who created it — shown as the authoring peer so a change is attributable. */
  createdBy?: string;
  editing: boolean;
  selected: boolean;
  editable: boolean;
  onEditChange(id: string | null): void;
  onSelectionChange(id: string | null): void;
  /** Press on the text itself: select and let the generic transform gesture move it. */
  onObjectPointerDown?(e: PointerEvent, id: string): void;
  /** Delete through the board's history-aware actions (story 8). */
  onDelete(id: string): void;
  /** Camera zoom, so the toolbar keeps its size when the board is zoomed. */
  zoom: number;
  /** This tab's undo controller, passed through to the text editor (story 8). */
  undo?: UndoController;
  /** Test hook: measure with something other than the browser's font engine. */
  measure?: Measurer;
}

/** The shared text of one board object, or undefined once the object is gone. */
export function getObjectYText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = doc.getMap<Y.Map<unknown>>('objects').get(id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Read one object's text, subscribed so remote updates re-render it. Undefined when
 * the object is gone (deleted elsewhere).
 */
function useObjectText(doc: Y.Doc, id: string): string | undefined {
  const read = (): string | undefined => getObjectYText(doc, id)?.toString();
  const [text, setText] = useState<string | undefined>(read);
  useEffect(() => {
    setText(read());
    const ytext = getObjectYText(doc, id);
    if (!ytext) return;
    const onText = (): void => setText(ytext.toString());
    ytext.observe(onText);
    return () => ytext.unobserve(onText);
  }, [doc, id]);
  return text;
}

/**
 * One free text on the board (story 9).
 *
 * Everything about where the text sits comes from the object's own `x`, `y`,
 * `width`, `height`: this component paints those numbers, it does not measure the
 * DOM. `TextEditor` writes each keystroke into the shared `Y.Text` and the box is
 * re-measured by this tab right after its own change (PRD text.autosize_shared), so
 * every other peer draws the same box from the same numbers.
 *
 * Editing behaves exactly like a sticky note: Enter adds a line, Escape keeps the
 * text and the selection, Backspace edits characters instead of deleting the object,
 * and text stays when the click lands somewhere else.
 */
export function TextObject(props: TextObjectProps) {
  const { doc, id, size, createdBy, editing, selected, editable } = props;
  const fontPx = TEXT_SIZES[size];

  // Re-measure the box after this tab changed the text; never for somebody else's change.
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, props.measure);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const text = useObjectText(doc, id);
  const ytext = getObjectYText(doc, id);
  const onEditChangeRef = useRef(props.onEditChange);
  onEditChangeRef.current = props.onEditChange;
  const onSelectionChangeRef = useRef(props.onSelectionChange);
  onSelectionChangeRef.current = props.onSelectionChange;
  const onDeleteRef = useRef(props.onDelete);
  onDeleteRef.current = props.onDelete;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  // A text with nothing in it takes up nothing, so it goes away (PRD text.delete_empty)
  // — whether this tab deleted every character or another tab did. While this tab is
  // editing, emptying is left to the end of the edit, so the object being typed into
  // does not vanish between keystrokes.
  useEffect(() => {
    const observed = getObjectYText(doc, id);
    if (!observed) return;
    const onText = (): void => {
      if (editingRef.current) return;
      if (observed.toString().length === 0) onDeleteRef.current(id);
    };
    observed.observe(onText);
    return () => observed.unobserve(onText);
  }, [doc, id]);

  /** Called when this tab stops typing: the object survives only if it has text left. */
  const endEditing = (next: 'selected' | 'unselected'): void => {
    // An empty text is removed in the same local transaction that removed its last
    // character, so nothing invisible is left behind (PRD text.empty_removed).
    const kept = !deleteIfEmpty(doc, id);
    onEditChangeRef.current(null);
    onSelectionChangeRef.current(kept && next === 'selected' ? id : null);
  };

  /**
   * The toolbar's size buttons (PRD text.size): the top-left never moves, only the
   * box changes, and one size change is one undo step.
   */
  const changeSize = (next: TextSize): void => {
    if (!editable) return;
    props.undo?.boundary();
    if (setTextSize(doc, id, next)) remeasureAfterLocalChange();
    props.undo?.boundary();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!editable) return;
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    // Typing, and the toolbar floating over the text, are presses on something else:
    // they must not select-drag the text around (PRD text.consistent).
    if (target.closest('.text-toolbar') || target.closest('.board-text-input')) return;
    onSelectionChangeRef.current(id);
    // Moving and resizing stay the generic gesture's job, not a text-specific one.
    props.onObjectPointerDown?.(e.nativeEvent, id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    // Editing from the toolbar is not text creation, and Enter never creates either.
    onEditChangeRef.current(id);
  };

  if (text === undefined) {
    // Somebody deleted this text; the board simply stops rendering it.
    return null;
  }

  return (
    <div
      ref={rootRef}
      className="board-object text-object"
      data-object-root=""
      data-text-id={id}
      data-testid="text-object"
      data-selected={selected}
      data-editing={editing}
      data-size={size}
      data-width-mode={props.widthMode}
      data-created-by={createdBy}
      style={{
        transform: `translate(${props.x}px, ${props.y}px)`,
        // The box is what the document says it is; nothing here is measured from the DOM.
        width: `${props.width}px`,
        height: `${props.height}px`,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {selected && !editing ? (
        <div
          className="text-toolbar-anchor"
          style={{
            left: props.width / 2,
            top: 0,
            transform: `scale(${1 / (props.zoom > 0 ? props.zoom : 1)})`,
          }}
        >
          <TextToolbar
            size={size}
            onSizeChange={changeSize}
            onDelete={() => {
              if (!editable) return;
              onDeleteRef.current(id);
            }}
          />
        </div>
      ) : null}

      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={props.width}
          onInput={() => remeasureAfterLocalChange()}
          onEnd={endEditing}
          undo={props.undo}
          rootSelector="[data-text-id]"
          inputClassName="board-text-input"
          inputTestId="text-object-input"
          inputAriaLabel="Text"
        />
      ) : (
        <div className="board-text-content" data-testid="text-content" style={{ fontSize: `${fontPx}px` }}>
          {text}
        </div>
      )}
    </div>
  );
}
