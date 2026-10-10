import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit, counterVisible, type EndEditNext } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: EndEditNext): void;
}

// Plain textarea diffed into the Y.Text on every input event, so ending
// editing never needs an extra write. IME composition is skipped until
// compositionend to avoid duplicating characters.
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.toString().length);

  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.value = ytext.toString();
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [ytext]);

  const commit = (raw: string) => {
    const el = textareaRef.current;
    const clamped = clampToLimit(raw);
    if (el !== null && clamped !== raw) {
      el.value = clamped;
      // Caret goes back to the end of the kept text after a truncation.
      el.setSelectionRange(clamped.length, clamped.length);
    }
    if (ytext.toString() !== clamped) {
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    }
    setLength(clamped.length);
  };

  useEffect(() => {
    // Pointerdown anywhere outside the textarea ends editing unselected.
    // Capture phase so note/toolbar stopPropagation cannot hide the click.
    const onPointerDown = (e: PointerEvent) => {
      const el = textareaRef.current;
      if (el === null) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      commit(el.value);
      onEnd('unselected');
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEnd]);

  return (
    <>
      <textarea
        ref={textareaRef}
        data-testid="sticky-textarea"
        className="sticky-textarea"
        style={{ fontSize: fontPx }}
        onInput={(e) => {
          if (composingRef.current) return;
          commit(e.currentTarget.value);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false;
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            commit(e.currentTarget.value);
            onEnd('selected');
          }
          // Enter is not intercepted: the textarea inserts a new line.
        }}
        onBlur={(e) => {
          // Defensive flush; text may exist without a blur event (note deleted).
          commit(e.currentTarget.value);
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
      />
      {counterVisible(length) && (
        <div className="sticky-counter" data-testid="sticky-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </>
  );
}
