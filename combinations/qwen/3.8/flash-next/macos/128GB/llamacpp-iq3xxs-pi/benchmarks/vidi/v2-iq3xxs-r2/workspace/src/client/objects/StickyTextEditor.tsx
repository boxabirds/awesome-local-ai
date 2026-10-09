import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
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
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
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
