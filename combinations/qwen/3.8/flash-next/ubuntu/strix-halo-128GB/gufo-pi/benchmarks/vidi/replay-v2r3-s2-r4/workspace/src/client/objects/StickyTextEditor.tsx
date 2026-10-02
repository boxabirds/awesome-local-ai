import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';

export interface StickyTextEditorProps {
  /** The note's shared text; every input event is written straight to it. */
  ytext: Y.Text;
  /** Current auto-fit font size in board units. */
  fontPx: number;
  /** Called on Escape ('selected') or a pointer down outside the note ('unselected'). */
  onEnd(next: 'selected' | 'unselected'): void;
  /** Padding around the text box, in board units (matches the note's own padding). */
  inset?: number;
}

/**
 * The text editor of a sticky note.
 *
 * Mounting is "start editing": the textarea takes the note's text, is focused
 * and the caret goes to the end. Every `input` event is clamped to the length
 * limit and written to Y.Text as a minimal diff, so ending editing performs no
 * additional write and all typed text is already kept.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd, inset = 0 }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.toString().length);

  // Start editing: value from the document, focus, caret at the end of the text.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    setLength(el.value.length);
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [ytext]);

  const commit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const raw = el.value;
    const clamped = clampToLimit(raw);
    if (clamped !== raw) {
      // Characters beyond the limit are dropped; caret stays at the end of kept text.
      el.value = clamped;
      const caret = Math.min(clamped.length, Math.max(el.selectionStart, el.selectionEnd));
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        // Some browsers refuse setSelectionRange on non-text inputs; nothing to restore.
      }
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    setLength(el.value.length);
  }, [ytext]);

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      // During IME composition the intermediate text must not reach the document.
      if (composingRef.current) return;
      e.stopPropagation();
      commit();
    },
    [commit],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    commit();
  }, [commit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        commit();
        onEnd('selected');
        return;
      }
      // Enter inserts a newline; anything else typed stays local to the textarea.
      e.stopPropagation();
    },
    [commit, onEnd],
  );

  const handleBlur = useCallback(() => {
    // Defensive flush: every input event has already been written.
    commit();
  }, [commit]);

  const stop = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-note-editor"
        data-testid="sticky-editor"
        aria-label="Sticky note text"
        style={{ inset, fontSize: fontPx }}
        spellCheck={false}
        onInput={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onPointerDown={stop}
        onDoubleClick={stop}
      />
      {counterVisible(length) ? (
        <div className="sticky-note-counter" data-testid="char-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      ) : null}
    </>
  );
}
