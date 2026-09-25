/**
 * In-place editor for an object's Y.Text, shared by sticky notes (story 2) and free text
 * (story 9) (anchors: sticky.edit_start, sticky.edit_end, text.edit, text.limit).
 *
 * Every `input` event is written straight to the Y.Text with a minimal diff (clamped to
 * `maxChars`), so ending editing needs no extra write and unmounting can never lose
 * characters. During IME composition nothing is written; the composed text is written on
 * compositionend. `onInput` runs after each local write (story 9 remeasures the box).
 *
 * Undo (anchor: undo.boundaries): editing starts and ends an undo step boundary, so typing
 * never merges with other actions; bursts of typing are grouped by the history's capture
 * timeout. Ctrl/Cmd+Z (redo: Ctrl/Cmd+Shift+Z, Ctrl+Y) undoes typing in this object
 * through the shared history instead of the textarea's native undo, which would diverge
 * from the Y.Text; it never reaches past the typing into earlier actions while editing.
 *
 * Editing ends on Escape (object stays selected) or a pointerdown outside the element with
 * the object's `data-id` that contains the editor (selection cleared).
 */
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { isDetachedText, LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampAtCaret } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

/** Moves a caret index across a Y.Text delta made by someone else. */
function shiftIndex(index: number, delta: Y.YTextEvent['delta']): number {
  let pos = 0;
  let result = index;
  for (const op of delta) {
    if (op.retain !== undefined) {
      pos += op.retain;
    } else if (op.insert !== undefined) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1;
      if (pos <= result) result += len;
      pos += len;
    } else if (op.delete !== undefined) {
      if (pos < result) result -= Math.min(op.delete, result - pos);
    }
    if (pos > result) break;
  }
  return result;
}

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  /** Editor width in world units, or 'auto' to leave it to the stylesheet. */
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undo: UndoController;
  /** Types (besides `ytext`) that typing also changes, e.g. the stored text box. */
  undoAlso?: readonly Y.AbstractType<any>[];
  className?: string;
  ariaLabel?: string;
  style?: CSSProperties;
}

export function TextEditor(props: TextEditorProps): React.JSX.Element {
  const { ytext, onEnd, undo: history, maxChars } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  // Edit start and end are undo step boundaries.
  useEffect(() => {
    history.boundary();
    return () => history.boundary();
  }, [history]);

  const commit = () => {
    const el = ref.current;
    if (el === null || composing.current || isDetachedText(ytext)) return;
    const { text, caret } = clampAtCaret(el.value, el.selectionEnd ?? el.value.length, maxChars);
    if (text !== el.value) {
      el.value = text;
      el.setSelectionRange(caret, caret);
    }
    if (text === ytext.toString()) return;
    applyTextDiff(ytext, text, LOCAL_ORIGIN);
    latest.current.onInput();
  };

  // Edit start: value from the document, focus, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const value = ytext.toString();
    el.value = value;
    el.focus({ preventScroll: true });
    el.setSelectionRange(value.length, value.length);
  }, [ytext]);

  // Changes made to the text by anyone else show up here with the caret kept in place.
  useEffect(() => {
    const onChange = (e: Y.YTextEvent, tr: Y.Transaction) => {
      const el = ref.current;
      if (el === null || tr.origin === LOCAL_ORIGIN) return;
      const value = ytext.toString();
      if (el.value === value) return;
      const start = shiftIndex(el.selectionStart, e.delta);
      const end = shiftIndex(el.selectionEnd, e.delta);
      el.value = value;
      el.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));
    };
    ytext.observe(onChange);
    return () => ytext.unobserve(onChange);
  }, [ytext]);

  // Edit end by a pointerdown anywhere outside this object, before focus moves.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const owner = ref.current?.closest('[data-id]');
      if (owner instanceof Element && e.target instanceof Node && owner.contains(e.target)) return;
      commit();
      onEnd('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
    // commit only reads refs, `ytext` and `maxChars`, which are fixed for this effect's lifetime.
  }, [onEnd, ytext]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Keys typed into the editor never trigger board shortcuts (Delete, Enter, T, ...).
    e.stopPropagation();
    const key = e.key.toLowerCase();
    const ctrlOrMeta = (e.ctrlKey || e.metaKey) && !e.altKey;
    const isUndo = ctrlOrMeta && key === 'z' && !e.shiftKey;
    const isRedo = (ctrlOrMeta && key === 'z' && e.shiftKey) || (e.ctrlKey && !e.metaKey && !e.altKey && key === 'y');
    if (isUndo || isRedo) {
      e.preventDefault();
      if (composing.current) return;
      commit();
      history.boundary();
      const also = latest.current.undoAlso ?? [];
      if (isUndo) history.undoIn(ytext, ...also);
      else history.redoIn(ytext, ...also);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      commit();
      onEnd('selected');
    }
  };

  const style: CSSProperties = {
    ...props.style,
    fontSize: `${props.fontPx}px`,
    width: props.width === 'auto' ? undefined : `${props.width}px`,
  };

  return (
    <textarea
      ref={ref}
      className={props.className}
      aria-label={props.ariaLabel}
      spellCheck
      style={style}
      onInput={(e) => {
        if ((e.nativeEvent as InputEvent).isComposing) return;
        commit();
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        commit();
      }}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
