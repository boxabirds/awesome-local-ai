import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { useUndoController } from '../board/useUndo';
import {
  applyLocalEdit,
  clampToLimit,
  counterVisible,
  remoteShift,
  type TextDeltaOp,
} from './StickyText';

export interface StickyTextEditorProps {
  /** The note's shared text; every `input` event is written to it immediately. */
  ytext: Y.Text;
  /** Auto-fitted font size in board units, measured by the note. */
  fontPx: number;
  /** Escape ends editing and keeps the note selected; a click outside does not. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The textarea that edits a sticky note.
 *
 * It is uncontrolled: the edit the person made is written into the `Y.Text` on every
 * `input` event (skipped while an IME is composing, flushed on `compositionend`), so
 * ending editing needs no write of its own. Input that would pass the 1,000 character
 * limit is cut before it reaches the document and the caret is restored to the end of
 * what was kept.
 *
 * Two people in one note (story 3) is what shapes the rest of it. The write is the
 * difference between what the textarea held last time and what it holds now
 * (`applyLocalEdit`), never the difference between the textarea and the shared text —
 * otherwise a word the other person typed a moment ago would look like something to
 * delete, and one character in fifty would vanish. Changes from the other side are
 * mirrored into the textarea as they arrive, with the caret stepped over them, so what
 * this person sees, what they type into, and what the document holds stay the same text.
 *
 * Story 8 adds one thing to that: the shared text is also what undo takes back. The editor
 * closes an undo step at both ends of the edit, so a burst of typing is one step, and
 * Ctrl/Cmd+Z typed *into* the note undoes the typing instead of the note underneath it.
 * Because the textarea keeps being a mirror of the shared text, an undo done anywhere —
 * here, by the toolbar, by another person deleting a word — shows up in it unchanged.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const undo = useUndoController();
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  /** What the textarea held the last time it was written to the document. */
  const lastValueRef = useRef(ytext.toString());
  const [length, setLength] = useState(() => ytext.toString().length);

  /** Write this person's own edit into the document, clamped to the character limit. */
  const sync = (): void => {
    const el = textareaRef.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped.length !== el.value.length) {
      el.value = clamped;
      // The dropped characters are simply gone: the caret sits at the end of what stayed.
      el.setSelectionRange(clamped.length, clamped.length);
    }
    applyLocalEdit(ytext, lastValueRef.current, el.value, LOCAL_ORIGIN);
    lastValueRef.current = el.value;
    setLength(el.value.length);
  };

  // The mount is the edit start: the note's text appears with the caret at its end.
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

  // Story 8: one edit session is one undo step (TC-12, TC-16). The step closes when the
  // caret goes into the note and again when it leaves, whatever the pause between the two,
  // so typing before and after the session are not merged with it and a burst of keystrokes
  // inside it is a single step.
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
    const onInput = (): void => {
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
    el.addEventListener('input', onInput);
    el.addEventListener('compositionstart', onCompositionStart);
    el.addEventListener('compositionend', onCompositionEnd);
    el.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('input', onInput);
      el.removeEventListener('compositionstart', onCompositionStart);
      el.removeEventListener('compositionend', onCompositionEnd);
      el.removeEventListener('blur', onBlur);
    };
  }, [ytext]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // Escape ends editing and keeps the note selected; Enter stays the textarea's own
    // new line, and Delete/Backspace edit characters instead of deleting the note.
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

  return (
    <>
      <textarea
        ref={textareaRef}
        className="vidi6-sticky-editor"
        data-testid="sticky-editor"
        aria-label="Sticky note text"
        style={{ fontSize: `${fontPx}px` }}
        spellCheck={false}
        onKeyDown={onKeyDown}
      />
      {counterVisible(length) ? (
        <span
          className="vidi6-sticky-counter"
          data-testid="sticky-counter"
          aria-live="polite"
        >
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </span>
      ) : null}
    </>
  );
}
