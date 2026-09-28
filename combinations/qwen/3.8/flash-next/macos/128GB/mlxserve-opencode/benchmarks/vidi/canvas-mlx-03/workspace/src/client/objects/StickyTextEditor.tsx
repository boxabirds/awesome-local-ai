import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model.ts';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config.ts';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText.ts';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The in-note textarea for editing. On mount it seeds the textarea from Y.Text,
 * focuses it and parks the caret at the end of the text. Every `input` (skipped
 * during IME composition, handled on `compositionend`) is clamped to the length
 * limit and written to Y.Text with a minimal diff — so ending an edit needs no
 * final write. Enter inserts a newline (not intercepted); Escape ends editing.
 */
export function StickyTextEditor(props: StickyTextEditorProps) {
  const { ytext, fontPx, onEnd } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [len, setLen] = useState(() => ytext.toString().length);

  // Mount: seed value, focus, caret at end of the existing text.
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.value = ytext.toString();
    setLen(ta.value.length);
    ta.focus();
    const end = ta.value.length;
    try {
      ta.setSelectionRange(end, end);
    } catch {
      /* jsdom may not support selection ranges */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    const ta = ref.current;
    if (!ta) return;
    const raw = ta.value;
    const clamped = clampToLimit(raw);
    if (clamped !== raw) {
      ta.value = clamped;
      const end = clamped.length;
      try {
        ta.setSelectionRange(end, end);
      } catch {
        /* ignore */
      }
    }
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    setLen(clamped.length);
  };

  const onInput = () => {
    if (composingRef.current) return;
    commit();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      commit();
      onEnd('selected');
    }
    // Enter intentionally falls through: it inserts a newline in the textarea.
  };

  return (
    <>
      <textarea
        ref={ref}
        data-testid="sticky-text-editor"
        className="sticky-note__editor"
        spellCheck={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          resize: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          fontSize: `${fontPx}px`,
          lineHeight: 1.25,
          padding: 0,
          margin: 0,
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          overflow: 'hidden',
          boxSizing: 'border-box',
          caretColor: '#2c2f36',
        }}
        onInput={onInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          commit();
        }}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={() => {
          // Defensive flush: every input is already committed, but guard any
          // pending value not routed through `input` (skipped mid-composition).
          if (!composingRef.current) commit();
        }}
      />
      {counterVisible(len) ? (
        <span
          data-testid="sticky-counter"
          className="sticky-note__counter"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 4,
            fontSize: 11,
            color: 'rgba(44,47,54,0.7)',
            pointerEvents: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {len}/{STICKY_TEXT_MAX_CHARS}
        </span>
      ) : null}
    </>
  );
}
