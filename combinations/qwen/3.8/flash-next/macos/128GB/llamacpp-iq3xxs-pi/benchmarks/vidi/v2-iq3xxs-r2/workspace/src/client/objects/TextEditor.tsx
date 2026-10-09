import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import type * as Y from 'yjs';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import {
  applyLocalEdit,
  clampToLimit,
  remoteShift,
  type TextDeltaOp,
} from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  /** The object's shared text; every `input` event is written to it immediately. */
  ytext: Y.Text;
  /** Longer than this and the extra characters never reach the document. */
  maxChars: number;
  /** Font size in board units, decided by the object that owns the text. */
  fontPx: number;
  /**
   * The box the text is wrapped at, in board units, so the textarea wraps where the object
   * will be drawn. `'auto'` leaves the width to the object's own CSS — a sticky note's text
   * box is its note, not a number this component could guess.
   */
  width: number | 'auto';
  /**
   * Called after every write to the document, so the object that owns the text can measure
   * what it just typed. A sticky note has nothing to measure (its text box is the note), so
   * it passes nothing.
   */
  onInput?(): void;
  /** Escape ends editing and keeps the object selected; a click outside does not. */
  onEnd(next: 'selected' | 'unselected'): void;
  /** This board's history: one editing session is one undo step, and Ctrl/Cmd+Z is typing's. */
  undo: UndoController | null;
  /** The object's own styling and accessible name; each type keeps the handles it had. */
  className: string;
  testId: string;
  ariaLabel: string;
  /** Under the editor: a sticky note's character counter, and nothing for plain text. */
  renderCounter?: (length: number) => ReactNode;
}

/**
 * The textarea that edits an object's text — story 2's sticky note editor, generalised.
 *
 * It is uncontrolled: the edit the person made is written into the `Y.Text` on every
 * `input` event (skipped while an IME is composing, flushed on `compositionend`), so ending
 * editing needs no write of its own. Input that would pass `maxChars` is cut before it
 * reaches the document and the caret is restored to the end of what was kept.
 *
 * Two people in one text (story 3, and `text.concurrent` here) is what shapes the rest of
 * it. The write is the difference between what the textarea held last time and what it holds
 * now (`applyLocalEdit`), never the difference between the textarea and the shared text —
 * otherwise a word the other person typed a moment ago would look like something to delete,
 * and one character in fifty would vanish. Changes from the other side are mirrored into the
 * textarea as they arrive, with the caret stepped over them, so what this person sees, what
 * they type into, and what the document holds stay the same text.
 *
 * What a text object adds to a sticky note's editor is only the two things the two types
 * differ on: `maxChars`, and `onInput`, which is how an object learns it needs re-measuring.
 */
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undo,
  className,
  testId,
  ariaLabel,
  renderCounter,
}: TextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  /** What the textarea held the last time it was written to the document. */
  const lastValueRef = useRef(ytext.toString());
  const [length, setLength] = useState(() => ytext.toString().length);

  /** Write this person's own edit into the document, clamped to the character limit. */
  const sync = (): void => {
    const el = textareaRef.current;
    if (!el) return;
    const clamped = clampToLimit(el.value, maxChars);
    if (clamped.length !== el.value.length) {
      el.value = clamped;
      // The dropped characters are simply gone: the caret sits at the end of what stayed.
      el.setSelectionRange(clamped.length, clamped.length);
    }
    applyLocalEdit(ytext, lastValueRef.current, el.value, LOCAL_ORIGIN);
    lastValueRef.current = el.value;
    setLength(el.value.length);
    // The owner may need to know the text is a different shape than it was.
    onInputRef.current?.();
  };

  // The mount is the edit start: the text appears with the caret at its end.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const initial = ytext.toString();
    if (el.value !== initial) el.value = initial;
    lastValueRef.current = el.value;
    setLength(initial.length);
    el.focus();
    if (typeof el.setSelectionRange === 'function') {
      el.setSelectionRange(initial.length, initial.length);
    }
  }, [ytext]);

  // A change from the other side of the board: the counter follows it, and so does the
  // textarea, with the caret stepped over whatever landed in front of it. Nothing is
  // mirrored into an IME composition, which would break the text being composed; it is
  // written once the composition ends.
  useEffect(() => {
    const observer = (event: Y.YTextEvent, transaction?: Y.Transaction): void => {
      if (transaction?.origin === LOCAL_ORIGIN) return;
      const next = ytext.toString();
      setLength(next.length);
      const el = textareaRef.current;
      if (el === null || composingRef.current || el.value === next) return;
      const { at, shift } = remoteShift(event.delta as unknown as TextDeltaOp[]);
      const selectionStart = el.selectionStart ?? 0;
      const selectionEnd = el.selectionEnd ?? 0;
      el.value = next;
      lastValueRef.current = next;
      const step = (offset: number): number =>
        offset <= at ? offset : Math.max(at, offset + shift);
      el.setSelectionRange(step(selectionStart), step(selectionEnd));
    };
    ytext.observe(observer);
    return () => {
      ytext.unobserve(observer);
    };
  }, [ytext]);

  // Story 8: one edit session is one undo step (TC-12, TC-16, and TC-25 for a text). The
  // step closes when the caret goes into the text and again when it leaves, whatever the
  // pause between the two, so typing before and after the session are not merged with it and
  // a burst of keystrokes inside it is a single step.
  useEffect(() => {
    undo?.boundary();
    return () => {
      undo?.boundary();
    };
  }, [undo]);

  // Native `input`, so the value React renders never fights the DOM value, and IME
  // composition is written once on `compositionend` instead of per keystroke.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const onInputEvent = (): void => {
      if (composingRef.current) return;
      sync();
    };
    const onCompositionStart = (): void => {
      composingRef.current = true;
    };
    const onCompositionEnd = (): void => {
      composingRef.current = false;
      sync();
    };
    const onBlur = (): void => {
      if (!composingRef.current) sync();
    };
    el.addEventListener('input', onInputEvent);
    el.addEventListener('compositionstart', onCompositionStart);
    el.addEventListener('compositionend', onCompositionEnd);
    el.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('input', onInputEvent);
      el.removeEventListener('compositionstart', onCompositionStart);
      el.removeEventListener('compositionend', onCompositionEnd);
      el.removeEventListener('blur', onBlur);
    };
  }, [ytext, maxChars]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // Escape ends editing and keeps the object selected; Enter stays the textarea's own
    // new line, and Delete/Backspace edit characters instead of deleting the object.
    if (event.key === 'Escape') {
      event.preventDefault();
      sync();
      onEndRef.current('selected');
      return;
    }
    // Story 8 (PRD: "While typing in a note, Ctrl/Cmd+Z undoes typing in that note"): this
    // textarea has no text of its own to undo, so the shortcut steps the shared text back.
    // Without `preventDefault` the browser would undo the textarea's value on its own and
    // leave the document behind, which is the one thing a mirror must never do.
    const key = event.key;
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && !event.altKey && (key === 'z' || key === 'Z' || key === 'y' || key === 'Y')) {
      event.preventDefault();
      if (!undo) return;
      // Anything this person typed but has not written yet is written first, so the step
      // they are undoing is the one they just made.
      sync();
      if (key === 'y' || key === 'Y' || event.shiftKey) undo.redo();
      else undo.undo();
    }
  };

  const style = {
    fontSize: `${fontPx}px`,
    ...(typeof width === 'number' ? { width: `${width}px` } : null),
  };

  return (
    <>
      <textarea
        ref={textareaRef}
        className={className}
        data-testid={testId}
        aria-label={ariaLabel}
        style={style}
        spellCheck={false}
        onKeyDown={onKeyDown}
      />
      {renderCounter ? renderCounter(length) : null}
    </>
  );
}
