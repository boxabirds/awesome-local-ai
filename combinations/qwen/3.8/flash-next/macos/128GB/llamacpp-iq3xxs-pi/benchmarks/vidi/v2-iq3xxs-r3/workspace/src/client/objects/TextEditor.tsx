import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, ChangeEvent, CompositionEvent, KeyboardEvent } from 'react';
import type * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import type { UndoController } from '../board/undo';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import { mapCaret, type TextDeltaOp } from './remote-text';

export interface TextEditorProps {
  /** The object's text; every input event is diffed into it. */
  ytext: Y.Text;
  /**
   * The hard limit for this kind of text: characters past it are dropped
   * (`sticky.text_limit` passes a note's 1,000, `text.object` a heading's 5,000).
   */
  maxChars: number;
  /** Font size in board units, so the text scales with the zoom like the object. */
  fontPx: number;
  /**
   * How wide the field is: a number of board units, or `'auto'` when the owner
   * sizes it in CSS (a note's editor fills the note; a text's editor is as wide as
   * the text's box, which is what makes it wrap where the text will wrap).
   */
  width: number | 'auto';
  /**
   * Called after every write this client made, so the owner can re-measure the box
   * that the new characters need (`text.height`). Optional because a note fits its
   * text to its box instead, and has nowhere to grow.
   */
  onInput?(): void;
  /** Escape -> 'selected'; pointerdown outside the object -> 'unselected'. */
  onEnd(next: 'selected' | 'unselected'): void;
  /**
   * This person's undo history (story 8). The edit is one step: a boundary is
   * called when it opens and when it closes, so nothing typed is merged with the
   * drag before it or the click after it, and Ctrl/Cmd+Z typed into the object is
   * answered against the board's history rather than the field's own, which knows
   * nothing about the board.
   */
  readonly undo?: UndoController | undefined;
  /**
   * Whether this much text is worth counting down (`sticky.text_limit`). A note
   * passes its own rule — it shows the count as its 1,000 runs out — and a heading
   * passes nothing, because nobody asked for a heading counted up, and its 5,000 is
   * a wall rather than a countdown.
   */
  readonly counter?: ((length: number) => boolean) | undefined;
  /** The class the owner's CSS sizes this field by. */
  readonly className?: string | undefined;
  /** The test id of the field, which its owner's tests query by. */
  readonly testId?: string | undefined;
}

/**
 * The text field an object shows while it is being typed in (`sticky.edit_start`,
 * `sticky.edit_end`, `sticky.text_limit`, `text.object`).
 *
 * It is one editor for both kinds of text this board has, because everything it
 * does is the same for a note and for a heading and would otherwise be written
 * twice: every `input` event is diffed into the `Y.Text` immediately, so ending
 * the edit performs no additional write and nothing typed can get lost; input is
 * skipped while an IME is composing and applied on `compositionend`, so composed
 * input never duplicates characters; and on mount the caret is placed at the end
 * of the existing text.
 *
 * While somebody else is typing in the same object (story 3), the document is the
 * truth: their characters are copied in as they arrive and the caret moves with
 * the text. Without that, the next keystroke would be diffed against a stale copy
 * of the string and would delete what just arrived.
 *
 * The field is a `textarea` rather than a `contenteditable`, because the whole of
 * the above is about *text*, and a textarea is the one element whose value is a
 * string: a contenteditable's value is a document, and every rule here would have
 * to be re-argued against markup, pasting and the browser's own editing commands.
 */
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undo,
  counter,
  className,
  testId,
}: TextEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => ytext.toString());
  const composingRef = useRef(false);
  /** Where the caret belongs after the remote change being applied now. */
  const caretRef = useRef<{ start: number; end: number } | null>(null);
  /** Latest onEnd, so the document listener is attached only once. */
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  /** And the same for the owner's remeasure, and for the history. */
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const undoRef = useRef(undo);
  undoRef.current = undo;

  /** Ending the edit also ends its undo step (`undo.capture`). */
  const closeEdit = (next: 'selected' | 'unselected'): void => {
    undoRef.current?.boundary();
    onEndRef.current(next);
  };

  // edit_start: value from the doc, focus, caret at the end. Opening the object is
  // a boundary too, so the first keystroke is never added to whatever the board
  // did a moment before it.
  useEffect(() => {
    undoRef.current?.boundary();
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    // Mount only: later doc changes flow through the local value state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // edit_end: a pointerdown outside the object ends the edit as 'unselected'.
  // Capture phase: the object stops propagation, but a document listener still
  // sees the press before anything else reacts to it. Both kinds of object name
  // themselves with an id attribute, which is what "outside" is measured against.
  useEffect(() => {
    const el = ref.current;
    const owner = el?.closest('[data-note-id], [data-text-id]') ?? null;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (owner && target instanceof Node && owner.contains(target)) return;
      closeEdit('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  // live.merge: somebody else's characters land in this field as they come from
  // the room, and the caret keeps its place next to them. Only changes that did
  // not start here count — our own typing is already in the value.
  useEffect(() => {
    const onRemote = (event: Y.YTextEvent): void => {
      if (event.transaction.origin === LOCAL_ORIGIN) return;
      const next = ytext.toString();
      const el = ref.current;
      if (el) {
        const caret = mapCaret(
          { start: el.selectionStart ?? next.length, end: el.selectionEnd ?? next.length },
          event.delta as unknown as TextDeltaOp[],
        );
        caretRef.current = { start: keep(caret.start, next), end: keep(caret.end, next) };
      }
      setValue(next);
    };
    ytext.observe(onRemote);
    return () => ytext.unobserve(onRemote);
  }, [ytext]);

  // React writes the value, and the browser drops the caret at the end of it.
  // This runs after that write and before the paint, so the caret is back in
  // place before anybody could see it move.
  useLayoutEffect(() => {
    const caret = caretRef.current;
    const el = ref.current;
    if (!caret || !el) return;
    caretRef.current = null;
    el.setSelectionRange(caret.start, caret.end);
  });

  const commit = (raw: string): void => {
    const next = clampToLimit(raw, maxChars);
    // Characters past the limit are dropped and the caret sits at the end of the
    // kept text (`sticky.text_limit`, `text.limit`).
    if (next.length !== raw.length) {
      const el = ref.current;
      if (el) {
        el.value = next;
        el.setSelectionRange(next.length, next.length);
      }
    }
    setValue(next);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    // The box a new character needs is the owner's business (`text.height`), and
    // it is measured in the same capture window, so one undo step takes back the
    // character and the height it caused as one thing.
    onInputRef.current?.();
  };

  const onInputEvent = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    // While composing, the raw string may be an unfinished IME candidate;
    // compositionend writes it.
    if (composingRef.current) {
      setValue(event.target.value);
      return;
    }
    commit(event.target.value);
  };

  const onCompositionStart = (): void => {
    composingRef.current = true;
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>): void => {
    composingRef.current = false;
    commit(event.currentTarget.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Escape ends editing, the text stays (`sticky.edit_end`, `text.empty`'s
    // counterpart: leaving an empty object behind is decided by its owner).
    if (event.key === 'Escape') {
      event.preventDefault();
      closeEdit('selected');
      return;
    }
    // Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y are the board's history here, not
    // the field's: the browser would undo a keystroke the document still holds,
    // and the next character typed would diff the two back together into one
    // object nobody recognises (TC-16).
    const history = undoRef.current;
    if (!history || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    event.preventDefault();
    if (key === 'y' || (key === 'z' && event.shiftKey)) history.redo();
    else history.undo();
  };

  const onBlur = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    // Defensive flush: by contract every input event was already written.
    // Skipped when the object was deleted from under the editor (TC-24, TC-37) so
    // a detached text is never written to.
    if (!event.currentTarget.isConnected) return;
    commit(event.currentTarget.value);
  };

  return (
    <>
      <textarea
        ref={ref}
        className={className}
        data-testid={testId}
        value={value}
        style={{
          fontSize: `${fontPx}px`,
          // A text's field is as wide as its box, so what is being typed wraps
          // where the finished text will wrap; a note sizes its field in CSS.
          ...(width === 'auto' ? null : { width: `${width}px` }),
        }}
        spellCheck={false}
        onChange={onInputEvent}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {counter?.(value.length) ? (
        <div
          className="char-counter"
          data-testid="char-counter"
          aria-label={`${value.length} of ${maxChars} characters`}
        >
          {`${value.length}/${maxChars}`}
        </div>
      ) : null}
    </>
  );
}

/** Never point outside the text: a stale caret would throw in the browser. */
function keep(index: number, text: string): number {
  return Math.max(0, Math.min(index, text.length));
}
