import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model.js';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config.js';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText.js';

/** How the editor finds the note it belongs to (for "clicked outside the note"). */
export const STICKY_NOTE_ATTRIBUTE = 'data-sticky-note';

export interface StickyTextEditorProps {
  /** The shared text of the note: every change is written straight into it. */
  ytext: Y.Text;
  /** Font size chosen by the note's auto-fit, in board units. */
  fontPx: number;
  /** Escape (still selected) or a click outside (nothing selected). */
  onEnd(next: 'selected' | 'unselected'): void;
}

/** The editor's accessible name. */
export const STICKY_EDITOR_LABEL = 'Sticky note text';

/**
 * The note's text editor: an uncontrolled textarea whose content is written
 * into the shared `Y.Text` as it is typed.
 *
 * Every `input` event is applied immediately (as a minimal diff), so finishing
 * editing performs no write at all and can never lose text - Escape, a click
 * outside, or the note disappearing mid-edit all keep what the user typed
 * (sticky.edit_end). IME composition is left to the browser and applied once,
 * on `compositionend`, so composing a character cannot duplicate it.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const ytextRef = useRef(ytext);
  ytextRef.current = ytext;

  const [length, setLength] = useState<number>(() => ytext.toString().length);

  /** Clamp the textarea's own value and write it into the shared text. */
  const commit = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const kept = clampToLimit(el.value);
    if (kept !== el.value) {
      // Characters beyond the limit are dropped and the caret stays at the end
      // of the text that was kept (sticky.text_limit).
      const caret = Math.min(kept.length, el.selectionStart);
      el.value = kept;
      el.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytextRef.current, el.value, LOCAL_ORIGIN);
    setLength((previous) => (previous === el.value.length ? previous : el.value.length));
  }, []);

  const handleInput = useCallback(() => {
    // During IME composition the textarea holds the in-progress text; the real
    // characters arrive with compositionend.
    if (composingRef.current) return;
    commit();
  }, [commit]);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    commit();
  }, [commit]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      // Escape ends editing and keeps the note selected; the text is already in
      // the document, so there is nothing else to do.
      event.preventDefault();
      onEndRef.current('selected');
    }
    // Enter is left alone: the textarea inserts a new line (PRD behaviour).
  }, []);

  // Put the caret at the end of the existing text as soon as the editor is
  // mounted (sticky.edit_start: "the cursor at the end of its text"), and focus
  // so the very next keystroke lands in the note - which is what makes a
  // double-click-then-type flow work without another click.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  // A pointerdown anywhere outside the note ends editing and clears the
  // selection (sticky.edit_end). Capture phase, because the board and the other
  // notes stop pointer propagation.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const el = textareaRef.current;
      const note = el?.closest(`[${STICKY_NOTE_ATTRIBUTE}]`);
      const target = event.target as Node | null;
      if (!note || !target) return;
      if (note.contains(target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  // Somebody else's change (story 3) arrives in the shared text: show it, unless
  // it is the change we have just written ourselves.
  useEffect(() => {
    const observer = (event: Y.YTextEvent) => {
      if (event.transaction.origin === LOCAL_ORIGIN) return;
      const el = textareaRef.current;
      if (!el) return;
      const next = ytextRef.current.toString();
      if (el.value === next) return;
      const caret = Math.min(next.length, el.selectionStart);
      el.value = next;
      el.setSelectionRange(caret, caret);
      setLength(next.length);
    };
    ytextRef.current.observe(observer);
    return () => ytextRef.current.unobserve(observer);
  }, []);

  const showCounter = counterVisible(length);

  return (
    <>
      <textarea
        ref={textareaRef}
        className="sticky-editor"
        data-testid="sticky-editor"
        aria-label={STICKY_EDITOR_LABEL}
        defaultValue={ytext.toString()}
        style={{ fontSize: `${fontPx}px` }}
        spellCheck={false}
        autoComplete="off"
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        // Ending editing writes nothing extra; this only picks up a value the
        // browser changed without an input event we could see.
        onBlur={commit}
        onPointerDown={(event) => event.stopPropagation()}
      />
      {showCounter ? (
        <span className="sticky-counter" data-testid="sticky-counter" data-remaining={STICKY_TEXT_MAX_CHARS - length}>
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </span>
      ) : null}
    </>
  );
}
