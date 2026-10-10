import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_PADDING_WORLD, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDelta, clampToLimit, counterVisible } from './StickyText';

/**
 * The textarea that edits one sticky note's `sticky.text` (anchor `sticky.text`).
 *
 * Every input event writes the change to Y.Text immediately, so finishing editing
 * performs no additional write and nothing typed is lost.
 *
 * What is written is the difference between the text the person was looking at
 * (`mirrorRef`) and what they changed it to - never the whole value. Someone
 * else's typing arrives into the same note while this editor is open; writing the
 * local value back wholesale would overwrite it (story 3, TC-23). After each
 * write the mirror is re-read from the document, so this editor always shows the
 * board's text, including other people's characters.
 */
export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  /** Painted over the note's own text so only one copy is visible. */
  background?: string;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor(props: StickyTextEditorProps) {
  const { ytext, fontPx, background, onEnd } = props;
  const [value, setValue] = useState(() => ytext.toString());
  /** The text this editor last showed; the base for the next local edit. */
  const mirrorRef = useRef(ytext.toString());

  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  /** Set when characters were dropped, so the caret can be restored. */
  const caretRef = useRef<number | null>(null);

  // Caret at the end of the text when editing starts.
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    el.focus();
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      // jsdom: setSelectionRange exists, but never mind if a browser refuses.
    }
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || caretRef.current === null) {
      return;
    }
    const position = caretRef.current;
    caretRef.current = null;
    try {
      el.setSelectionRange(position, position);
    } catch {
      // ignore
    }
  }, [value]);

  // Text changed somewhere else (story 3): show it, unless it is our own write.
  useEffect(() => {
    const observer = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) {
        return;
      }
      const remote = ytext.toString();
      mirrorRef.current = remote;
      setValue(remote);
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  const commit = (next: string) => {
    const kept = clampToLimit(next);
    if (kept.length !== next.length) {
      caretRef.current = kept.length; // caret to the end of the kept text
    }
    applyTextDelta(ytext, mirrorRef.current, kept, LOCAL_ORIGIN);
    // The document is the board's truth: it can hold other people's typing too.
    const current = ytext.toString();
    mirrorRef.current = current;
    setValue(current);
  };

  const handleInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) {
      return; // IME: wait for compositionend (not automated by tests)
    }
    commit(event.currentTarget.value);
  };

  const handleCompositionEnd = (event: React.CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    commit(event.currentTarget.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      commit(event.currentTarget.value);
      ref.current?.blur();
      onEnd('selected');
      return;
    }
    // Enter inside the textarea is a new line; Delete/Backspace edit characters.
  };

  const handleBlur = () => {
    const el = ref.current;
    if (el && !composingRef.current) {
      // Defensive flush: anything still unapplied from this editor only.
      applyTextDelta(ytext, mirrorRef.current, clampToLimit(el.value), LOCAL_ORIGIN);
      mirrorRef.current = ytext.toString();
    }
  };

  const showCounter = counterVisible(value.length);

  return (
    <div className="sticky-note__editor-wrap" data-testid="sticky-editor-wrap">
      <textarea
        ref={ref}
        className="sticky-note__editor"
        data-testid="sticky-editor"
        value={value}
        aria-label="Sticky note text"
        spellCheck={false}
        style={{
          fontSize: `${fontPx}px`,
          padding: `${STICKY_PADDING_WORLD}px`,
          background: background ?? 'transparent',
        }}
        onChange={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onPointerDown={(event) => event.stopPropagation()}
      />
      {showCounter ? (
        <output
          className="sticky-note__counter"
          data-testid="sticky-counter"
          aria-label={`${value.length} of ${STICKY_TEXT_MAX_CHARS} characters`}
        >
          {`${value.length}/${STICKY_TEXT_MAX_CHARS}`}
        </output>
      ) : null}
    </div>
  );
}
