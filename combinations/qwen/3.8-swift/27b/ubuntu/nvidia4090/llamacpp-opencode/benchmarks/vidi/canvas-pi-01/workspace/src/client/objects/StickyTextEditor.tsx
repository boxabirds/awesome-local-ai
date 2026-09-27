// Text editing inside a sticky note (see spec: sticky.text).
//
// A transparent textarea over the note. Every `input` event is written to
// Y.Text immediately (minimal diff, clamped to the limit), so ending editing
// performs no additional write — unmounting the textarea cannot lose
// characters.

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible, fitFontSize } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Last known fitted font size; the editor re-fits itself on mount. */
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const [value, setValue] = useState(() => ytext.toString());
  const [measured, setMeasured] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx,
    overflow: false,
  });

  const finish = useCallback(
    (next: 'selected' | 'unselected') => {
      if (endedRef.current) return;
      endedRef.current = true;
      onEnd(next);
    },
    [onEnd],
  );

  // Start editing: focus with the caret at the end of the text.
  useEffect(() => {
    const ta = taRef.current;
    if (ta === null) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, []);

  // Auto-fit: on mount and on every text change (not on zoom — font is in
  // world units, so zoom scales it uniformly).
  useEffect(() => {
    const ta = taRef.current;
    if (ta === null) return;
    setMeasured(fitFontSize(ta, STICKY_SIZE_WORLD));
  }, [value]);

  // A pointerdown anywhere outside this note ends editing as 'unselected'.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const wrapper = wrapperRef.current;
      if (wrapper !== null && event.target instanceof Node && !wrapper.contains(event.target)) {
        finish('unselected');
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [finish]);

  const sync = useCallback(
    (raw: string) => {
      const clamped = clampToLimit(raw);
      if (clamped !== raw) {
        // Restore the caret to the end of the kept text after truncation.
        const ta = taRef.current;
        if (ta !== null) {
          ta.value = clamped;
          ta.setSelectionRange(clamped.length, clamped.length);
        }
      }
      setValue(clamped);
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    },
    [ytext],
  );

  const handleInput = () => {
    if (composingRef.current) return; // IME: sync on compositionend instead.
    const ta = taRef.current;
    if (ta !== null) sync(ta.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish('selected');
    }
    // Enter inserts a newline (default textarea behaviour; not intercepted).
  };

  // Defensively flush a pending value on blur (normally a no-op: every input
  // event was already written to Y.Text).
  const handleBlur = () => {
    if (composingRef.current) return;
    const ta = taRef.current;
    if (ta !== null && ta.value !== ytext.toString()) sync(ta.value);
  };

  return (
    <div ref={wrapperRef} data-testid="sticky-editor" className="sticky-editor">
      <textarea
        ref={taRef}
        className="sticky-editor-textarea"
        value={value}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          handleInput();
        }}
        spellCheck={false}
        aria-label="Sticky note text"
      />
      {measured.overflow && <div data-testid="sticky-fade" className="sticky-fade" aria-hidden="true" />}
      {counterVisible(value.length) && (
        <span
          data-testid="sticky-counter"
          className="sticky-counter"
          aria-label={`${value.length} of ${STICKY_TEXT_MAX_CHARS} characters used`}
        >
          {value.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
