import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';

const PADDING_PX = 16;

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * Text editor for a sticky note. The textarea is diffed into the note's
 * Y.Text on every input event (common prefix + suffix, one transaction),
 * clamped to STICKY_TEXT_MAX_CHARS, with the caret restored to the end of
 * the kept text when clamping trimmed characters.
 *
 * - Escape → onEnd('selected')
 * - pointerdown outside the note → onEnd('unselected')
 * - Enter inserts a newline (native textarea behaviour)
 * - IME composition: input events are skipped while composing and handled
 *   once on compositionend
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const [value, setValue] = useState(() => ytext.toString());

  // Focus with the caret at the end of the text (edit start contract).
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  const finish = (next: 'selected' | 'unselected') => {
    if (endedRef.current) return;
    endedRef.current = true;
    onEnd(next);
  };

  // pointerdown anywhere outside the note ends editing as 'unselected'.
  // Registered in the capture phase so it fires before other handlers.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest('[data-sticky-note]')) return;
      finish('unselected');
    };
    window.addEventListener('pointerdown', handler, true);
    return () => {
      window.removeEventListener('pointerdown', handler, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const writeValue = (raw: string) => {
    const clamped = clampToLimit(raw);
    const el = ref.current;
    if (el && clamped !== el.value) {
      // Truncated: restore the caret to the end of the kept text.
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    setValue(clamped);
    applyTextDiff(ytext, clamped, undefined);
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return; // handled on compositionend
    writeValue(e.currentTarget.value);
  };

  const handleCompositionEnd = (e: React.FormEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    writeValue(e.currentTarget.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish('selected');
    }
    // Enter falls through: the textarea inserts a newline natively.
  };

  // Defensive flush on blur: every input event already wrote to Y.Text, so
  // normally there is nothing pending.
  const handleBlur = () => {
    const el = ref.current;
    if (el && el.value !== ytext.toString()) {
      applyTextDiff(ytext, clampToLimit(el.value), undefined);
    }
  };

  const showCounter = counterVisible(value.length);

  return (
    <div
      data-testid="sticky-editor"
      style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}
    >
      <textarea
        ref={ref}
        data-testid="sticky-textarea"
        aria-label="Sticky note text"
        value={value}
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        spellCheck={false}
        style={{
          flex: 1,
          width: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          padding: PADDING_PX,
          fontFamily: 'inherit',
          fontSize: `${fontPx}px`,
          lineHeight: 1.2,
          color: 'inherit',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      />
      {showCounter && (
        <div
          data-testid="sticky-counter"
          aria-label={`Characters: ${value.length} of ${STICKY_TEXT_MAX_CHARS}`}
          style={{
            position: 'absolute',
            right: 6,
            bottom: 4,
            fontSize: 11,
            color: 'rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          {value.length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
