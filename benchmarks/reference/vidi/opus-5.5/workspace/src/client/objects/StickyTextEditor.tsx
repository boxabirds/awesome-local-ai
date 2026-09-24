import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { EndEditNext } from '../board/useSelection';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: EndEditNext): void;
}

/**
 * Transparent textarea laid over the note's text while editing. Every input event is
 * written straight to the Y.Text (minimal diff), so ending editing needs no extra write
 * and unmounting can never lose characters.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.length);

  const fitHeight = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // Edit start: current text, focused, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    setLength(end);
    fitHeight();
  }, [ytext]);

  useLayoutEffect(fitHeight, [fontPx]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      // Characters beyond the limit are dropped; caret goes to the end of the kept text.
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    setLength(clamped.length);
    fitHeight();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      commit();
      onEnd('selected');
    }
    // Enter is not intercepted: it inserts a newline.
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-note__editor"
        aria-label="Note text"
        maxLength={STICKY_TEXT_MAX_CHARS}
        spellCheck
        style={{ fontSize: `${fontPx}px` }}
        onChange={() => {
          if (!composingRef.current) commit();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          commit();
        }}
        onBlur={() => {
          // Defensive flush; normally every input event has already been written.
          if (!composingRef.current) commit();
        }}
        onKeyDown={onKeyDown}
      />
      {counterVisible(length) && (
        <div className="sticky-note__counter" aria-live="polite" data-testid="sticky-counter">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      )}
    </>
  );
}
