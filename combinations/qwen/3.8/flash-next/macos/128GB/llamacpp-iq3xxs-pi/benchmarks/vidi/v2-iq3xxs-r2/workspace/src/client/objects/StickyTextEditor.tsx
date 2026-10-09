import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

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
 * It is uncontrolled: the value is written into the `Y.Text` on every `input` event
 * (skipped while an IME is composing, flushed on `compositionend`), so ending editing
 * needs no write of its own. Input that would pass the 1,000 character limit is cut
 * before it reaches the document and the caret is restored to the end of what was kept.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const [length, setLength] = useState(() => ytext.toString().length);

  /** Mirror the textarea into the document, clamped to the character limit. */
  const sync = (): void => {
    const el = textareaRef.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped.length !== el.value.length) {
      el.value = clamped;
      // The dropped characters are simply gone: the caret sits at the end of what stayed.
      el.setSelectionRange(clamped.length, clamped.length);
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    setLength(el.value.length);
  };

  // The mount is the edit start: the note's text appears with the caret at its end.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const initial = ytext.toString();
    if (el.value !== initial) el.value = initial;
    setLength(initial.length);
    el.focus();
    if (typeof el.setSelectionRange === 'function') {
      el.setSelectionRange(initial.length, initial.length);
    }
  }, [ytext]);

  // Keep the counter honest when the text changes elsewhere (story 3).
  useEffect(() => {
    const observer = (): void => {
      setLength(ytext.toString().length);
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
